-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v75
-- Paiement en espèces choisi APRÈS la réservation, depuis la fiche commande (CommandeDetailView.tsx).
--
-- Contexte (Fouka, 16/08, test réel) : le choix carte/espèces (migration-connect-v71/v72 ronde
-- précédente) n'existait qu'AU MOMENT de réserver (wizard) — une commande déjà créée (avant ce
-- chantier, ou créée en mode "carte"/"à plusieurs" puis jamais soldée) n'avait aucun moyen de
-- basculer sur "réglé en espèces" depuis sa fiche : seul un bouton "Payer X €" (Stripe) était
-- proposé. Cette migration ajoute le chemin manquant, symétrique à ce qui existe déjà pour la
-- réservation solo et pour les cotisations (mode_paiement/contribute_funding_especes,
-- migration-connect-v73) : même philosophie de confiance, confirmation immédiate, sans
-- vérification staff bloquante.
--
-- Pourquoi une RPC dédiée plutôt qu'un update client direct sur prestations.mode_paiement_choisi :
-- prestations n'a aucune policy RLS UPDATE ouverte à un client (vérifié : les seules écritures
-- passent par les Edge Functions service_role) — cette RPC revérifie explicitement que l'appelant
-- a le droit "payer" sur cette prestation précise, via connect_client_ids_for_caller('payer')
-- (migration-connect-v51 §4, déjà utilisée par connect_get_order_funding_link, migration-connect-
-- v74, sur ce même écran) — couvre les 3 profils (joueur/club, particulier self, particulier
-- linked/managed) en une seule fonction, sans dupliquer la logique de resolve_player_client_id.
--
-- Idempotente
-- (create or replace function). Aucun redéploiement d'Edge Function nécessaire.
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- fonction connect_choose_especes_for_prestation existe déjà en base.
-- Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

create or replace function connect_choose_especes_for_prestation(p_prestation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prestation record;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select p.id, p.client_id, p.statut_financier, p.acompte_recu, p.mode_paiement_choisi
  into v_prestation
  from prestations p
  where p.id = p_prestation_id
    and p.client_id in (select client_id from connect_client_ids_for_caller('payer'));

  if not found then
    raise exception 'Commande introuvable ou non autorisée.';
  end if;

  if v_prestation.statut_financier in ('payée', 'partiellement_payée') or v_prestation.acompte_recu then
    raise exception 'Cette commande est déjà réglée.';
  end if;

  update prestations set mode_paiement_choisi = 'especes' where id = p_prestation_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function connect_choose_especes_for_prestation(uuid) to authenticated;
