-- Migration : Pipeline commercial v2 — 5 étapes de vente
-- À exécuter dans Supabase → SQL Editor

-- Étend la contrainte statut de la table clients pour supporter les 5 étapes du pipeline
-- (prospect → qualifié → devis_envoyé → négociation → partenaire)

alter table clients drop constraint if exists clients_statut_check;

alter table clients add constraint clients_statut_check
  check (statut in (
    'prospect',
    'qualifié',
    'devis_envoyé',
    'négociation',
    'partenaire',
    'client',
    'inactif',
    'bloqué',
    'perdu'
  ));

-- Index pour accélérer les requêtes pipeline (filtre par statut + score)
create index if not exists idx_clients_pipeline on clients(statut, score_priorite desc);
