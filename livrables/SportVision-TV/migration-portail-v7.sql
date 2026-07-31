-- ============================================================
-- SPORTVISION PORTAIL — Migration v7
-- Trace la renonciation au droit de rétractation (article L221-18 du Code de la
-- consommation) quand le client commande une prestation prévue sous 14 jours.
-- Idempotente. À exécuter après migration-portail-v6.sql.
-- ============================================================

alter table prestations add column if not exists retractation_renoncee boolean default false;
alter table prestations add column if not exists retractation_renoncee_at timestamptz;
