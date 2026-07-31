-- Migration : suivi de paiement des rémunérations collaborateurs
-- La table prestations_equipe n'a jamais eu de colonnes statut_paiement /
-- date_paiement, alors que tout l'écran Rémunérations (prod + compta),
-- le bouton "Payer", les KPI de rémunérations dues, l'onglet Budget de
-- la fiche prestation et "Mes revenus" côté collaborateur en dépendent.
-- Le code JS est déjà correct partout : il ne manquait que ces colonnes.
-- Idempotente : peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor

alter table prestations_equipe
  add column if not exists statut_paiement text default 'en_attente',
  add column if not exists date_paiement timestamptz;

alter table prestations_equipe drop constraint if exists prestations_equipe_statut_paiement_check;
alter table prestations_equipe add constraint prestations_equipe_statut_paiement_check
  check (statut_paiement in ('en_attente','validé','transmis_compta','payé'));

create index if not exists idx_pe_statut_paiement on prestations_equipe(statut_paiement);
