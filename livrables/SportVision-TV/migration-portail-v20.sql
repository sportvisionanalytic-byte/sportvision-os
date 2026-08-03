-- ============================================================
-- SPORTVISION PORTAIL — Migration v20
-- Facturation électronique réelle (Pennylane), en complément du PDF/e-mail
-- déjà existant. Stocke le lien entre nos clients/factures et leurs
-- équivalents Pennylane, pour ne créer chaque client qu'une seule fois et
-- retrouver la facture générée (numéro officiel, lien PDF public).
-- Idempotente. À exécuter après migration-portail-v19.sql.
-- ============================================================

alter table clients add column if not exists pennylane_customer_id text;

alter table factures add column if not exists pennylane_invoice_id text;
alter table factures add column if not exists pennylane_invoice_number text;
alter table factures add column if not exists pennylane_public_url text;
