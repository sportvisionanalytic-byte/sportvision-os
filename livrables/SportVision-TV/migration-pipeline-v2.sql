-- Migration : Pipeline commercial v2 — 5 étapes de vente
-- À exécuter dans Supabase → SQL Editor
--
-- Le champ statut sur la table clients est un TYPE ENUM PostgreSQL (statut_client).
-- On doit utiliser ALTER TYPE ... ADD VALUE pour étendre les valeurs possibles.

alter type statut_client add value if not exists 'devis_envoyé';
alter type statut_client add value if not exists 'négociation';
alter type statut_client add value if not exists 'partenaire';
alter type statut_client add value if not exists 'perdu';

-- Index pour accélérer les requêtes pipeline (filtre par statut + score)
create index if not exists idx_clients_pipeline on clients(statut, score_priorite desc);
