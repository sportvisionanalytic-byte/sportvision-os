-- ============================================================
-- SPORTVISION PORTAIL — Migration v2
-- Complète migration-portail-v1.sql : permet au client de créer réellement une demande
-- depuis le configurateur, et de l'annuler, sans jamais lui laisser toucher aux champs
-- financiers/internes de `prestations`.
-- Idempotente. À exécuter après migration-portail-v1.sql.
-- ============================================================

-- ── 1. Traçabilité de l'offre catalogue choisie ──

alter table prestations add column if not exists offre_id uuid references catalogue_offres(id) on delete set null;
alter table prestations add column if not exists options_selectionnees jsonb default '[]';

create index if not exists idx_prestations_offre on prestations(offre_id);

-- ── 2. Le client peut créer une demande (INSERT uniquement, jamais de SELECT/UPDATE direct) ──
-- La demande arrive toujours à l'état initial `demande_reçue`, avec tous les champs financiers
-- et internes forcés à leur valeur par défaut : c'est le staff qui les renseigne ensuite dans l'OS.
-- Le client ne peut donc jamais s'auto-attribuer un montant, un acompte réglé ou un statut avancé.

drop policy if exists "prestations_client_insert" on prestations;
create policy "prestations_client_insert" on prestations for insert with check (
  statut = 'demande_reçue'
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = prestations.client_id)
  and montant_ht is null
  and montant_ttc is null
  and acompte_montant is null
  and acompte_recu = false
  and acompte_date is null
  and statut_financier = 'non_facturée'
  and contrat_signe = false
  and responsable_prod_id is null
  and responsable_prestation_id is null
  and notes_internes is null
);

-- ── 3. Annulation d'une demande par le client — fonction dédiée ──
-- Uniquement possible tant que la prestation n'est pas engagée (avant devis accepté/acompte).

create or replace function client_cancel_prestation(p_prestation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_statut text;
begin
  select client_id, statut into v_client_id, v_statut from prestations where id = p_prestation_id;

  if v_client_id is null then
    raise exception 'Prestation introuvable';
  end if;

  if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id) then
    raise exception 'Non autorisé';
  end if;

  if v_statut not in ('demande_reçue','à_qualifier','offre_en_préparation','devis_envoyé','en_attente_réponse') then
    raise exception 'Cette demande ne peut plus être annulée en ligne, contactez SportVision.';
  end if;

  update prestations set statut = 'annulée', updated_at = now() where id = p_prestation_id;

  insert into historique (table_cible, entite_id, action, champ_modifie, ancienne_valeur, nouvelle_valeur)
  values ('prestations', p_prestation_id, 'annulation_client', 'statut', v_statut, 'annulée');
end;
$$;

revoke all on function client_cancel_prestation(uuid) from public;
grant execute on function client_cancel_prestation(uuid) to authenticated;

-- ── 4. Mise à jour de la vue client_prestations (ajout offre_id / options_selectionnees) ──

drop view if exists client_prestations;
create view client_prestations as
select
  p.id, p.reference, p.statut, p.type_prestation, p.client_id, p.offre_id, p.options_selectionnees,
  p.date_prestation, p.heure_debut, p.heure_fin, p.lieu, p.adresse_complete,
  p.sport, p.equipes, p.description_besoin, p.livrables_demandes,
  p.montant_ttc, p.acompte_montant, p.acompte_recu, p.acompte_date, p.statut_financier,
  p.created_at, p.updated_at
from prestations p
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = p.client_id
);
