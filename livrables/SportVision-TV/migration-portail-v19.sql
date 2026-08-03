-- ============================================================
-- SPORTVISION PORTAIL — Migration v19
-- Signature électronique réelle (Youtrust, ex-Yousign) pour devis et contrats,
-- en remplacement du statut "signée" auto-déclaré par le client. Stocke
-- l'identifiant de la demande de signature Youtrust pour que le webhook
-- puisse retrouver le bon document quand la signature est complétée.
-- Idempotente. À exécuter après migration-portail-v18.sql.
-- ============================================================

alter table devis add column if not exists youtrust_signature_request_id text;
alter table contrats add column if not exists youtrust_signature_request_id text;

create index if not exists idx_devis_youtrust_sr on devis(youtrust_signature_request_id);
create index if not exists idx_contrats_youtrust_sr on contrats(youtrust_signature_request_id);
