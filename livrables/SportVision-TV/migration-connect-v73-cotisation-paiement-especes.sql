-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v73
-- Paiement en espèces sur une contribution de cotisation (group_fundings /
-- funding_contributions, migration-connect-v50-groupes-cotisations-personnelles.sql).
--
-- Contexte (demande Fouka, 16/08) : un contributeur à une cotisation doit pouvoir choisir de
-- régler sa part en espèces (remise en main propre à l'organisateur de la cotisation, jamais à
-- SportVision) plutôt qu'en ligne par carte (Stripe) — même philosophie de confiance que le
-- choix carte/espèces déjà en place sur une réservation solo (migration-prestations-choix-
-- paiement-guest.sql + create-guest-request/index.ts) : le choix "espèces" confirme
-- IMMÉDIATEMENT, sans aucune condition bloquante ni vérification, c'est une simple déclaration
-- de confiance.
--
-- Différence assumée avec le précédent "réservation solo" : là-bas, `mode_paiement_choisi` est
-- une simple PRÉFÉRENCE déclarée (la prestation reste non soldée tant que le staff n'a pas
-- lui-même encaissé/reconcilié via `prestations.mode_paiement`) — ici, Fouka a explicitement
-- demandé que la contribution soit comptée immédiatement (statut='paye', montant_collecte
-- incrémenté), pas seulement une préférence. Deux comportements différents pour deux tables
-- différentes, chacun conforme à ce qui a été demandé pour lui.
--
-- Pourquoi une colonne séparée plutôt que réutiliser un champ existant : `funding_contributions`
-- n'a AUCUNE colonne "mode de paiement" aujourd'hui (vérifié dans migration-connect-v50). Nom
-- choisi en écho à `prestations.mode_paiement_choisi` (même vocabulaire produit : "carte" vs
-- "espèces") sans réutiliser cette colonne (appartient à une autre table, portée par un autre
-- chantier en parallèle sur ce projet).
--
-- Pourquoi une RPC SECURITY DEFINER plutôt qu'un insert client direct : `funding_contributions`
-- n'a AUJOURD'HUI AUCUNE policy RLS insert/update (vérifié dans migration-connect-v50, section 4
-- — "AUCUNE policy insert/update — toute écriture passe par les Edge Functions de paiement
-- (service role) ou par stripe-webhook, jamais un insert/update client direct sur un montant ou
-- un statut de paiement"). Un insert direct depuis le navigateur serait donc de toute façon
-- rejeté par RLS — mais plutôt que de contourner ça avec une nouvelle policy INSERT ouverte (qui
-- permettrait à N'IMPORTE QUEL utilisateur authentifié de s'auto-déclarer "payé" sur N'IMPORTE
-- QUELLE cotisation qu'il peut voir, sans plafond ni vérification du solde restant), cette
-- migration ajoute une RPC dédiée qui revérifie explicitement : l'accès en lecture
-- (can_view_group_funding, déjà en place), l'état "ouverte"/non expirée de la cotisation, et le
-- plafond au solde restant — exactement les mêmes gardes que create-funding-contribution-
-- checkout (Edge Function existante, paiement carte). Une RPC plutôt qu'une nouvelle Edge
-- Function : aucun appel externe (pas de Stripe ici, contrairement au paiement carte qui a
-- besoin de STRIPE_SECRET_KEY côté serveur) et cohérence avec les RPC d'écriture déjà en place
-- dans ce chantier (create_group_funding, join_user_group, migration-connect-v50) — zéro
-- redéploiement Edge Function nécessaire pour ce choix.
--
-- L'incrémentation de `group_fundings.montant_collecte` n'est PAS dupliquée ici en SQL/JS : le
-- trigger `trg_fc_recompute` (migration-connect-v50, déclenché sur tout insert/update/delete de
-- funding_contributions, quel que soit l'appelant) s'en charge automatiquement dès l'insert
-- ci-dessous, exactement comme il le fait déjà pour stripe-webhook.
--
-- Périmètre volontairement EXCLU — participation invitée (page publique /cotisation/[token],
-- SANS COMPTE) : pas de RPC "espèces" équivalente pour un contributeur invité. Contrairement à
-- une réservation solo en espèces (où le client final paie SportVision, qui peut réconcilier
-- après coup via `prestations.mode_paiement`), une contribution "espèces" à une cotisation est
-- remise en main propre à l'ORGANISATEUR de la cotisation (un particulier, pas SportVision) —
-- SportVision n'a aucun moyen de réconcilier cette déclaration après coup. Combiné à l'absence
-- totale d'identité vérifiable pour un invité (contrairement à un contributeur authentifié, dont
-- le compte reste tracé), une RPC invité "espèces" permettrait à N'IMPORTE QUI de gonfler
-- artificiellement `montant_collecte` d'une cotisation publique (fausse impression d'objectif
-- atteint pour les autres participants et l'organisateur) sans aucune barrière équivalente au
-- rate-limit IP qui protège aujourd'hui create-guest-funding-contribution-checkout (ce rate-limit
-- protège la création d'une session Stripe, pas un encaissement réel — un abus y reste sans
-- impact financier ; ici, un abus impacterait directement le montant affiché comme "collecté").
-- Principe de précaution appliqué : espèces réservé aux contributeurs authentifiés (Espace
-- joueur + Espace particulier). Page publique laissée strictement inchangée (carte uniquement,
-- ShareFundingButtons.tsx non touché).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (peut être rejouée sans effet de bord : add column if not exists, create or replace function).
-- Aucun redéploiement d'Edge Function nécessaire pour cette migration (RPC Postgres pure, active
-- dès l'exécution du script).
-- ============================================================

-- ── 1. COLONNE ──

alter table funding_contributions
  add column if not exists mode_paiement text
    check (mode_paiement in ('carte', 'especes'))
    not null default 'carte';

comment on column funding_contributions.mode_paiement is
  'Mode de règlement de CETTE contribution : carte = payée en ligne via Stripe (statut confirmé par stripe-webhook), especes = déclarée réglée en espèces par le contributeur lui-même au moment de sa participation (confirmée immédiatement, sans vérification staff bloquante — voir contribute_funding_especes). Défaut ''carte'' pour ne rétro-étiqueter aucune ligne existante par erreur : toute contribution déjà en base avant cette migration a été payée par carte (seul chemin qui existait).';

-- ── 2. RPC — contribution en espèces (contributeur authentifié uniquement) ──
-- Même gardes que create-funding-contribution-checkout (Edge Function, paiement carte) :
-- accès en lecture revérifié, cotisation ouverte et non expirée, montant plafonné au solde
-- restant. Différence : confirme directement (statut='paye') au lieu de créer une session
-- Stripe — c'est le sens même du paiement espèces (déclaration de confiance immédiate, voir
-- l'en-tête de cette migration).

create or replace function contribute_funding_especes(p_funding_id uuid, p_montant numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_funding group_fundings;
  v_montant_restant numeric(10,2);
  v_contribution_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  if p_montant is null or p_montant <= 0 then
    raise exception 'Indiquez un montant supérieur à 0 €.';
  end if;

  if not can_view_group_funding(p_funding_id) then
    raise exception 'Cotisation introuvable ou non autorisée.';
  end if;

  select * into v_funding from group_fundings where id = p_funding_id;
  if not found then
    raise exception 'Cotisation introuvable.';
  end if;

  -- Même re-vérification serveur de l'expiration que create-funding-contribution-checkout
  -- (migration-connect-v50 : pas de cron qui bascule statut -> 'expiree', dérivé à la lecture).
  if v_funding.statut <> 'ouverte'
     or (v_funding.date_limite is not null and v_funding.date_limite < current_date) then
    raise exception 'Cette cotisation n''accepte plus de nouvelles participations.';
  end if;

  v_montant_restant := round((v_funding.montant_cible - v_funding.montant_collecte)::numeric, 2);
  if v_montant_restant <= 0 then
    raise exception 'L''objectif de cette cotisation est déjà atteint.';
  end if;
  if p_montant > v_montant_restant then
    raise exception 'Le montant dépasse ce qu''il reste à collecter (% €).', v_montant_restant;
  end if;

  insert into funding_contributions (funding_id, contributor_user_id, montant, statut, mode_paiement)
  values (p_funding_id, auth.uid(), p_montant, 'paye', 'especes')
  returning id into v_contribution_id;
  -- group_fundings.montant_collecte / passage à 'objectif_atteint' : recalculés automatiquement
  -- par le trigger trg_fc_recompute (migration-connect-v50), jamais écrits ici directement.

  return jsonb_build_object('ok', true, 'contribution_id', v_contribution_id);
end;
$$;

grant execute on function contribute_funding_especes(uuid, numeric) to authenticated;
