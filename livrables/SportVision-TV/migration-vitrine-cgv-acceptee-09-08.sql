-- ============================================================
-- Migration — Traçabilité de l'acceptation des CGV (vitrine)
--
-- La case "J'ai lu et j'accepte les CGV" ajoutée le 09/08/2026 sur
-- livrables/SportVision/reserver.html envoie déjà cgv_acceptee /
-- cgv_acceptee_le à l'edge function create-guest-request, mais ces deux
-- colonnes n'existaient pas encore sur `prestations` — cette migration
-- les ajoute, même pattern que retractation_renoncee/retractation_renoncee_at
-- (migration-portail-v7.sql).
--
-- Idempotente (add column if not exists). À exécuter dans Supabase
-- → SQL Editor, par Fouka — jamais par un agent.
-- ============================================================

alter table prestations add column if not exists cgv_acceptee boolean default false;
alter table prestations add column if not exists cgv_acceptee_le timestamptz;
