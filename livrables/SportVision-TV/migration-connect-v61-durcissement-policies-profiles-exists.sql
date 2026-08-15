-- ============================================================
-- SPORTVISION — Migration v61 — NON EXÉCUTÉE
-- Défense en profondeur, suite à la re-vérification complète demandée par
-- Fouka après le correctif v58 ("un compte Connect peut-il encore, par
-- n'importe quel chemin, obtenir un accès staff ?").
--
-- ────────────────────────────────────────────────────────────────────────
-- CONSTAT (grep exhaustif de `exists (select 1 from profiles where id =
-- auth.uid())` — le motif brut PRÉ-is_staff(), sans aucune vérification de
-- rôle ni exclusion memberships/player_profiles/connect_profile_settings —
-- sur tout le schéma, en ne gardant que la définition LA PLUS RÉCENTE de
-- chaque policy, fichier par fichier vérifié individuellement)
-- ────────────────────────────────────────────────────────────────────────
--
-- v31 (11/08) puis v58 (15/08) ont chacun renforcé is_staff() : d'abord en
-- excluant les comptes avec une ligne `memberships` (clubs/coachs/académies
-- Connect), puis avec une ligne `player_profiles`/`connect_profile_settings`
-- (Connect personnel). Les policies qui appellent la FONCTION `is_staff()`
-- (ex. "Staff lecture annuaire" sur profiles, migration-audit-nocturne-
-- securite-11-08.sql) bénéficient donc automatiquement de ces deux
-- correctifs, sans rien à changer.
--
-- MAIS un nombre important de policies, écrites À DIFFÉRENTES ÉPOQUES avant
-- même la création de is_staff() (ou sans jamais avoir été migrées vers son
-- usage), INLINENT encore la version la plus primitive de la vérification :
-- "une ligne profiles existe pour auth.uid(), peu importe laquelle". Estce
-- qu'un compte Connect peut aujourd'hui satisfaire cette condition ? NON —
-- tant que v58 reste en place, aucun compte Connect n'obtient jamais de
-- ligne `profiles` (voir migration-connect-v58-...). Ce correctif n'est
-- donc PAS le bouchage d'une fuite activement exploitable aujourd'hui.
--
-- C'est en revanche un vrai problème de défense en profondeur : ces
-- policies n'ont JAMAIS bénéficié ni du filtre de rôle de is_staff(), ni de
-- son exclusion memberships/player_profiles/connect_profile_settings. Si un
-- futur bug (un 4e, après supabase-schema.sql → migration-profiles-
-- email.sql → migration-connect-v31 → le trigger v58 lui-même, cf. v60 dans
-- ce même lot) réintroduit un jour la création d'une ligne `profiles` pour
-- un compte non-staff, TOUTES CES TABLES seraient immédiatement exposées à
-- ce compte, sans passer par is_staff() donc sans bénéficier d'aucun des
-- correctifs déjà écrits. Autant fermer ce trou maintenant plutôt que
-- d'attendre un 5e incident.
--
-- Périmètre volontairement limité aux policies utilisant EXACTEMENT ce
-- motif sans filtre de rôle. Les policies qui vérifient déjà `role in
-- (...)` explicitement (ex. materiels_write, kit_ctrl_insert, etc.) ne sont
-- PAS touchées ici : une ligne profiles seule ne suffit déjà pas pour elles,
-- il faut en plus un rôle privilégié précis — gap différent, hors périmètre.
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF : remplace `exists (select 1 from profiles where id =
-- auth.uid())` par `is_staff()` dans chacune des policies suivantes,
-- SANS changer le reste de leur logique (conditions supplémentaires
-- inchangées : propriétaire, statut, acteur_id, publie=true, etc.).
-- Idempotent (DROP POLICY IF EXISTS + CREATE). NON EXÉCUTÉE — à relire puis
-- exécuter par Fouka dans Supabase → SQL Editor.
-- ============================================================


-- ─── media_liens (migration-medias.sql) ────────────────────────────────
drop policy if exists "ml_read" on media_liens;
create policy "ml_read" on media_liens for select using (is_staff());

drop policy if exists "ml_write" on media_liens;
create policy "ml_write" on media_liens for all using (is_staff());


-- ─── media_postproductions (migration-medias.sql) ──────────────────────
drop policy if exists "mp_read" on media_postproductions;
create policy "mp_read" on media_postproductions for select using (is_staff());


-- ─── media_versions (migration-medias.sql) ─────────────────────────────
drop policy if exists "mv_read" on media_versions;
create policy "mv_read" on media_versions for select using (is_staff());

drop policy if exists "mv_write" on media_versions;
create policy "mv_write" on media_versions for all using (is_staff());


-- ─── media_corrections (migration-medias.sql) ──────────────────────────
drop policy if exists "mc_read" on media_corrections;
create policy "mc_read" on media_corrections for select using (is_staff());

drop policy if exists "mc_write" on media_corrections;
create policy "mc_write" on media_corrections for all using (is_staff());


-- ─── media_validations (migration-medias.sql) ──────────────────────────
drop policy if exists "mval_read" on media_validations;
create policy "mval_read" on media_validations for select using (is_staff());


-- ─── media_livrables (migration-medias.sql) ────────────────────────────
drop policy if exists "mlivr_read" on media_livrables;
create policy "mlivr_read" on media_livrables for select using (is_staff());


-- ─── media_livraisons (migration-medias.sql) ───────────────────────────
drop policy if exists "mliv_read" on media_livraisons;
create policy "mliv_read" on media_livraisons for select using (is_staff());


-- ─── media_historique (migration-medias.sql) ───────────────────────────
drop policy if exists "mhist_read" on media_historique;
create policy "mhist_read" on media_historique for select using (is_staff());

drop policy if exists "mhist_insert" on media_historique;
create policy "mhist_insert" on media_historique for insert with check (is_staff());


-- ─── materiels (dernière version : migration-audit-08-08-securite-rls.sql) ─
drop policy if exists "materiels_select" on materiels;
create policy "materiels_select" on materiels for select using (is_staff());


-- ─── kit_compositions (dernière version : migration-audit-08-08-securite-rls.sql) ─
drop policy if exists "kit_comp_select" on kit_compositions;
create policy "kit_comp_select" on kit_compositions for select using (is_staff());


-- ─── kit_controles (dernière version : migration-audit-08-08-securite-rls.sql) ─
drop policy if exists "kit_ctrl_select" on kit_controles;
create policy "kit_ctrl_select" on kit_controles for select using (is_staff());


-- ─── kit_controle_items (dernière version : migration-audit-08-08-securite-rls.sql) ─
drop policy if exists "kit_ctrl_items_select" on kit_controle_items;
create policy "kit_ctrl_items_select" on kit_controle_items for select using (is_staff());


-- ─── frais (SELECT seulement — frais_insert a déjà été durcie par
--     migration-audit-08-08-securite-rls.sql avec collaborateur_id=auth.uid()) ─
drop policy if exists "frais_select" on frais;
create policy "frais_select" on frais for select using (is_staff());


-- ─── disponibilites (migration-disponibilites.sql) ─────────────────────
drop policy if exists "dispo_select" on disponibilites;
create policy "dispo_select" on disponibilites for select using (is_staff());


-- ─── avoirs (migration-documents-v1.sql) ───────────────────────────────
drop policy if exists "avoirs_read" on avoirs;
create policy "avoirs_read" on avoirs for select using (is_staff());


-- ─── document_events (migration-documents-v1.sql) ──────────────────────
drop policy if exists "doc_events_write" on document_events;
create policy "doc_events_write" on document_events for insert with check (is_staff());


-- ─── client_contacts (migration-crm-v2.sql) ────────────────────────────
drop policy if exists "clco_read" on client_contacts;
create policy "clco_read" on client_contacts for select using (is_staff());

drop policy if exists "clco_write" on client_contacts;
create policy "clco_write" on client_contacts for all using (is_staff());


-- ─── messages (migration-messagerie-v2.sql) — seule la branche broadcast
--     (destinataire_id is null) change, les branches expediteur/destinataire
--     directs restent inchangées ─────────────────────────────────────────
drop policy if exists "msg_select" on messages;
create policy "msg_select" on messages for select using (
  auth.uid() = expediteur_id
  or auth.uid() = destinataire_id
  or (destinataire_id is null and is_staff())
);

drop policy if exists "msg_update" on messages;
create policy "msg_update" on messages for update using (
  auth.uid() = destinataire_id
  or (destinataire_id is null and is_staff())
);


-- ─── formations_custom (migration-formations-admin.sql) ────────────────
drop policy if exists "fc_select" on formations_custom;
create policy "fc_select" on formations_custom for select using (is_staff());


-- ─── formations_quiz_custom (migration-formations-admin.sql) ───────────
drop policy if exists "fqc_select" on formations_quiz_custom;
create policy "fqc_select" on formations_quiz_custom for select using (is_staff());


-- ─── formation_sessions (migration-formation-v2.sql) ────────────────────
drop policy if exists "fsess_read" on formation_sessions;
create policy "fsess_read" on formation_sessions for select using (is_staff());


-- ─── email_templates (migration-phase3-4-5.sql) ─────────────────────────
drop policy if exists "email_tpl_read" on email_templates;
create policy "email_tpl_read" on email_templates for select using (is_staff());


-- ─── audit_logs (dernière version : migration-cm-audit-contenus.sql,
--     07/08 — conserve acteur_id = auth.uid() et le cas acteur_id null) ──
drop policy if exists "audit_staff_insert" on audit_logs;
create policy "audit_staff_insert" on audit_logs for insert with check (
  is_staff()
  and (acteur_id = auth.uid() or acteur_id is null)
);


-- ─── notifications — branche broadcast type='message' (définie à la fois
--     dans supabase-schema-v2.sql et migration-messages-broadcast.sql,
--     même nom de policy "notifs_messages_broadcast" ; s'additionne en OR
--     à notifs_acces déjà existante, inchangée) ───────────────────────────
drop policy if exists "notifs_messages_broadcast" on notifications;
create policy "notifs_messages_broadcast" on notifications
  for select using (
    type = 'message'
    and is_staff()
  );


-- ============================================================
-- Note volontairement PAS incluse dans ce lot : materiel_incidents,
-- frais_insert, mval_write, mlivr_write, mliv_write, mp_write,
-- kit_comp_write, kit_ctrl_insert/update/delete, kit_ctrl_items_insert/
-- update/delete, materiels_write — déjà correctement filtrées par rôle
-- explicite (role in (...)) dans des migrations antérieures, donc déjà
-- à l'abri même si une ligne profiles non-staff existait un jour. Rien à y
-- changer.
-- ============================================================
