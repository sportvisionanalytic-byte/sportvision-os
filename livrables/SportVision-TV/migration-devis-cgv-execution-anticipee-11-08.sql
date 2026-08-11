-- ============================================================
-- Migration — Déplace le recueil du consentement CGV + exécution
-- anticipée avant 14 jours au bon moment juridique : l'acceptation du
-- devis par le client (SportVision Connect), pas la simple demande
-- initiale sur reserver.html.
--
-- Contexte (audit externe, nuit du 10-11/08/2026) : reserver.html
-- capturait jusqu'ici "J'accepte les CGV" + "Je demande l'exécution
-- anticipée avant la fin du délai de rétractation de 14 jours" dès
-- l'étape 4 du tunnel, AVANT que SportVision ait validé la
-- disponibilité et AVANT que le client ait accepté un devis/
-- récapitulatif. Or CGV Art. 6.3 est clair : "une Prestation
-- ponctuelle devient ferme après validation de la disponibilité par
-- SportVision et acceptation par le Client du devis, bon de commande,
-- récapitulatif ou autre document contractuel matérialisant son
-- accord." La demande expresse d'exécution anticipée (CGV Art. 35.1)
-- n'a de sens que rattachée à CE moment-là, pas à une simple prise de
-- contact qui ne garantit même pas la disponibilité (CGV Art. 6.1).
--
-- Le vrai écran d'acceptation existe déjà en production : SportVision
-- Connect, module "Devis" (projet-dashboard-devis-contrats-factures.js),
-- bouton "Accepter" → RPC client_decide_devis() (créée par
-- migration-portail-v1.sql §12). C'est l'unique endroit du système où
-- un client accepte en ligne, de façon authentifiée, un devis qui rend
-- la prestation ferme (confirmé : aucune offre, même à prix fixe,
-- n'est payable depuis Connect sans passer par un devis accepté —
-- create-checkout-session ne fait que déclencher Stripe une fois le
-- devis "accepté", jamais avant).
--
-- Cette migration :
--   1. Ajoute à `devis` les colonnes de traçabilité du consentement
--      recueilli à l'acceptation (distinctes de prestations.cgv_acceptee
--      / retractation_renoncee, qui restent des traces de la simple
--      demande initiale, sans valeur de formation du contrat).
--   2. Étend la vue `client_devis` pour exposer ces colonnes ainsi que
--      la date de la prestation liée (nécessaire côté Connect pour
--      savoir si la case "exécution anticipée" doit être affichée :
--      uniquement si la prestation a lieu dans moins de 14 jours,
--      même règle que reserver.html avant ce correctif).
--   3. Remplace client_decide_devis(uuid, text) par
--      client_decide_devis(uuid, text, boolean, text, boolean) :
--      accepter un devis exige désormais explicitement p_cgv_acceptee
--      = true (vérifié côté serveur, pas seulement côté client), et
--      capture p_cgv_version + p_execution_anticipee_demandee au
--      moment exact de l'acceptation.
--
-- Idempotente (add column if not exists, create or replace, drop avant
-- recreate). À exécuter dans Supabase → SQL Editor, par Fouka —
-- JAMAIS par un agent. Un agent ne doit jamais exécuter de SQL contre
-- la production Supabase.
--
-- ⚠️ Déploiement couplé requis : cette migration doit être appliquée
-- EN MÊME TEMPS que la mise à jour de
-- livrables/SportVision-Connect/app/modules/projet-dashboard-devis-contrats-factures.js
-- (le nouveau JS appelle client_decide_devis avec 5 arguments ; tant
-- que cette migration n'est pas appliquée, seule l'ancienne signature
-- à 2 arguments existe et le nouvel appel JS échouera). Voir aussi le
-- rapport de cette session pour un bug préexistant et distinct trouvé
-- pendant l'investigation : le trigger trg_devis_signature_check
-- (migration-audit-08-08-corrections-interfaces.sql) bloque déjà tout
-- passage de devis.statut à 'accepté' sans signature_statut = 'signee'
-- (Youtrust), y compris via client_decide_devis — à vérifier/traiter
-- séparément avant de considérer le bouton "Accepter" de Connect comme
-- pleinement fonctionnel en prod.
-- ============================================================

-- ── 1. Colonnes de consentement sur `devis` ──
alter table devis add column if not exists cgv_version_acceptee text;
alter table devis add column if not exists cgv_acceptee_le timestamptz;
alter table devis add column if not exists execution_anticipee_demandee boolean not null default false;
alter table devis add column if not exists execution_anticipee_demandee_le timestamptz;

comment on column devis.cgv_version_acceptee is
  'Version des CGV (ex. "V1.0 (9 août 2026)", cf. cgv.html "Version finale") en vigueur au moment où le CLIENT a accepté CE devis — moment de formation du contrat (CGV Art. 6.3). Distinct de prestations.cgv_acceptee, qui ne trace qu''une prise de connaissance à la simple demande initiale, sans valeur contractuelle. Alimenté uniquement par client_decide_devis().';
comment on column devis.cgv_acceptee_le is
  'Horodatage exact (timestamptz) de l''acceptation des CGV par le client à l''acceptation du devis. Distinct de devis.date_acceptation (simple date, préexistante).';
comment on column devis.execution_anticipee_demandee is
  'Demande expresse du client (CGV Art. 35.1, Code de la consommation) que l''exécution de la prestation commence avant l''expiration du délai légal de rétractation de 14 jours. Capturée UNIQUEMENT à l''acceptation du devis (le moment où la prestation devient ferme), jamais à la simple demande initiale sur reserver.html.';
comment on column devis.execution_anticipee_demandee_le is
  'Horodatage de la demande d''exécution anticipée ci-dessus (null si non applicable ou non demandée).';

-- ── 2. `client_devis` — expose les nouvelles colonnes + la date de la
--       prestation liée (pour piloter l'affichage conditionnel de la
--       case exécution anticipée côté Connect) ──
-- Reprend exactement la définition de migration-clubplus-v33-club-
-- documents-access.sql (branche club incluse), en ajoutant les 4
-- nouvelles colonnes et un left join sur prestations.date_prestation.
drop view if exists client_devis;
create view client_devis as
select
  d.id, d.numero, d.statut, d.client_id, d.prestation_id,
  d.lignes, d.sous_total, d.remise_pct, d.remise_montant, d.tva_pct, d.total_ht, d.total_ttc,
  d.validite_jours, d.date_envoi, d.date_expiration, d.date_acceptation, d.notes,
  d.cgv_version_acceptee, d.cgv_acceptee_le,
  d.execution_anticipee_demandee, d.execution_anticipee_demandee_le,
  p.date_prestation,
  d.created_at, d.updated_at
from devis d
left join prestations p on p.id = d.prestation_id
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = d.client_id
) or club_member_has_client_access(d.client_id);

-- ── 3. `client_decide_devis` — capture le consentement à l'acceptation ──
-- Supprime explicitement l'ancienne signature à 2 arguments : sans ce
-- drop, Postgres conserverait les deux fonctions en parallèle
-- (surcharge par signature), et l'ancien appel JS (déjà en prod tant
-- que le nouveau front n'est pas déployé) continuerait de fonctionner
-- SANS jamais capturer le consentement — silencieusement. On préfère
-- un échec net et couplé au déploiement du nouveau front.
drop function if exists client_decide_devis(uuid, text);

create or replace function client_decide_devis(
  p_devis_id uuid,
  p_decision text,
  p_cgv_acceptee boolean default false,
  p_cgv_version text default null,
  p_execution_anticipee_demandee boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_statut_actuel text;
begin
  if p_decision not in ('accepté','refusé') then
    raise exception 'Décision invalide';
  end if;

  select client_id, statut into v_client_id, v_statut_actuel from devis where id = p_devis_id;

  if v_client_id is null then
    raise exception 'Devis introuvable';
  end if;

  if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id) then
    raise exception 'Non autorisé';
  end if;

  if v_statut_actuel not in ('envoyé','en_attente') then
    raise exception 'Ce devis ne peut plus être accepté ou refusé';
  end if;

  -- L'acceptation d'un devis vaut formation du contrat (CGV Art. 6.3) : les
  -- CGV doivent être explicitement acceptées à ce moment précis. Vérifié
  -- côté serveur (pas seulement côté client) — un refus ne l'exige jamais.
  if p_decision = 'accepté' and not coalesce(p_cgv_acceptee, false) then
    raise exception 'Acceptation des CGV requise pour accepter ce devis';
  end if;

  update devis
  set statut = p_decision::statut_devis,
      date_acceptation = case when p_decision = 'accepté' then current_date else date_acceptation end,
      cgv_version_acceptee = case when p_decision = 'accepté' then p_cgv_version else cgv_version_acceptee end,
      cgv_acceptee_le = case when p_decision = 'accepté' then now() else cgv_acceptee_le end,
      execution_anticipee_demandee = case when p_decision = 'accepté' then coalesce(p_execution_anticipee_demandee, false) else execution_anticipee_demandee end,
      execution_anticipee_demandee_le = case when p_decision = 'accepté' and coalesce(p_execution_anticipee_demandee, false) then now() else execution_anticipee_demandee_le end,
      updated_at = now()
  where id = p_devis_id;

  insert into document_events (event_type, document_ref, document_type, description)
  values ('modification', (select numero from devis where id = p_devis_id), 'devis',
          case when p_decision = 'accepté'
            then 'Devis accepté par le client (CGV ' || coalesce(p_cgv_version, '—') || ')'
              || (case when coalesce(p_execution_anticipee_demandee, false) then ' — exécution anticipée demandée' else '' end)
            else 'Devis refusé par le client'
          end);
end;
$$;

revoke all on function client_decide_devis(uuid, text, boolean, text, boolean) from public;
grant execute on function client_decide_devis(uuid, text, boolean, text, boolean) to authenticated;
