-- ============================================================
-- Migration : durcissement des journaux d'audit (audit_logs,
-- communication_audit_logs) pour qu'ils soient réellement
-- append-only, comme l'exige le cahier des charges sécurité
-- (section 22 — "Journal d'audit immuable").
--
-- ─── Failles corrigées ───────────────────────────────────────────────────────
--
-- 1. `audit_logs` — policy "audit_staff_insert" (migration-portail-v1.sql:296) :
--    `with check (exists (select 1 from profiles where id = auth.uid()))`.
--    N'importe quel membre du staff authentifié peut insérer une ligne avec
--    N'IMPORTE QUEL `acteur_id` de son choix — rien n'oblige `acteur_id` à
--    correspondre à l'auteur réel de la requête. Un journal d'audit où
--    l'auteur peut être falsifié par l'auteur lui-même ne prouve rien : un
--    collaborateur pourrait attribuer une action sensible à un collègue.
--
-- 2. `audit_logs` et `communication_audit_logs` n'ont aucune policy UPDATE/
--    DELETE : sous RLS Postgres, ça revient déjà à un refus par défaut (aucune
--    policy permissive = 0 ligne affectée pour un rôle soumis à RLS), mais ça
--    repose uniquement sur "absence de policy" plutôt que sur une interdiction
--    explicite — une policy UPDATE/DELETE ajoutée par erreur plus tard sur
--    l'une de ces deux tables romprait silencieusement l'immuabilité. On rend
--    l'interdiction explicite au niveau des privilèges eux-mêmes.
--
-- ─── Ce que fait cette migration ────────────────────────────────────────────
-- 1. Resserre "audit_staff_insert" : `acteur_id` doit être égal à `auth.uid()`.
-- 2. REVOKE UPDATE, DELETE explicite sur les deux tables pour `authenticated`
--    et `anon` — l'écriture applicative reste possible via `service_role`
--    (Edge Functions), qui contourne RLS et les GRANT de toute façon.
--
-- Idempotente : les REVOKE sur des privilèges déjà absents ne font rien (pas
-- d'erreur), et la policy est recréée via DROP IF EXISTS + CREATE. À exécuter
-- dans Supabase → SQL Editor.

drop policy if exists "audit_staff_insert" on audit_logs;
create policy "audit_staff_insert" on audit_logs for insert with check (
  acteur_id = auth.uid()
  and exists (select 1 from profiles where id = auth.uid())
);

revoke update, delete on audit_logs from authenticated, anon;
revoke update, delete on communication_audit_logs from authenticated, anon;
