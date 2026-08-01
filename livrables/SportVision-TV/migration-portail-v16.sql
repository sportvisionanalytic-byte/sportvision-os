-- ============================================================
-- SPORTVISION PORTAIL — Migration v16
-- Catégorie sur les réalisations, pour filtrer la page publique "Réalisations"
-- par type de prestation (mêmes catégories que catalogue_offres).
-- Idempotente. À exécuter après migration-portail-v15.sql.
-- ============================================================

alter table realisations add column if not exists categorie text
  check (categorie in ('photo','video','pack','tournoi','stage','shooting','drone','veo','contenu'));
