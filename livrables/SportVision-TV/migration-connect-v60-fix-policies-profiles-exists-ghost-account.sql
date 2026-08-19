-- ============================================================
-- SPORTVISION — Migration v60
-- Corrige 25 policies RLS (16 tables) qui réimplémentent "est membre du
-- staff" en dur avec `exists (select 1 from profiles where id = auth.uid())`
-- au lieu d'appeler `is_staff()`.
--
-- ────────────────────────────────────────────────────────────────────────
-- CONTEXTE (audit RLS en lecture seule, 15/08/2026, suite au bug is_staff()
-- corrigé par migration-connect-v58-fix-handle-new-user-connect-personnel.sql)
-- ────────────────────────────────────────────────────────────────────────
--
-- `is_staff()` a déjà été corrigée à trois reprises pour NE PLUS traiter
-- "possède une ligne `profiles`" comme équivalent à "est du staff interne" :
--   - v2  (originale) : `select exists (select 1 from profiles where id = auth.uid())`
--     — aucun filtre de rôle, aucune exclusion.
--   - v31 : ajoute le filtre de rôle + exclut les comptes ayant une ligne
--     `memberships` (clubs/coachs/académies Connect).
--   - v58 (ce soir) : exclut en plus les comptes ayant `player_profiles` ou
--     `connect_profile_settings` (nouveau Connect personnel — joueur/
--     particulier/agent), et arrête la création automatique d'une ligne
--     `profiles` pour tout signup public.
--
-- Cet audit (grep exhaustif sur les ~60 migrations `migration-connect-v*` +
-- les ~145 autres fichiers de `livrables/SportVision-TV/*.sql`, tri
-- chronologique par date de premier commit pour ne garder que la DERNIÈRE
-- définition active de chaque policy, DROP POLICY sans recréation inclus)
-- a trouvé que la MÊME faute que v2 — `exists (select 1 from profiles
-- where id = auth.uid())`, sans aucun filtre de rôle ni exclusion — a été
-- recopiée à la main, indépendamment de `is_staff()`, dans 25 policies
-- actuellement actives sur 16 tables (liste complète ci-dessous). Aucune
-- de ces 25 policies n'a bénéficié des corrections apportées à `is_staff()`
-- par v31 ou v58, puisqu'elles n'appellent jamais cette fonction.
--
-- IMPACT CONCRET : tout compte possédant une ligne `profiles` "fantôme"
-- (le bug corrigé par v58 — un compte Connect personnel qui, avant
-- exécution de v58, s'est vu attribuer `role='photo'` par le trigger
-- `handle_new_user`) obtient, via ces 25 policies :
--   - accès en LECTURE à : disponibilites (planning collaborateurs),
--     email_templates (contenu des templates envoyés aux clients),
--     formation_rewards / formation_sessions / formations_custom (contenu
--     de formation interne), materiels / kit_compositions / kit_controles /
--     kit_controle_items (inventaire matériel), et surtout TOUTE la chaîne
--     `media_*` (media_liens — dont `mot_de_passe_enc`, le mot de passe
--     des liens de rushs/livrables, et `confidentialite` — media_versions,
--     media_corrections, media_historique, media_livrables, media_livraisons,
--     media_postproductions, media_validations) ;
--   - accès en ÉCRITURE COMPLÈTE (insert/update/delete, policies "for all")
--     à : media_liens (`ml_write`), media_versions (`mv_write`),
--     media_corrections (`mc_write`) — sans AUCUN filtre de rôle, contrai-
--     rement à la plupart des autres policies d'écriture du même fichier
--     (`mp_write`/`mval_write`/`mlivr_write`/`mliv_write`/`mbib_write`
--     sont déjà correctement restreintes à admin/prod/sec) ;
--   - le droit d'INSÉRER dans `audit_logs` (le journal d'audit lui-même) et
--     `document_events` ;
--   - la LECTURE des messages d'équipe internes (broadcast, `destinataire_id
--     is null`) sur `messages`, et le droit de les marquer comme lus.
--
-- Vérifié en direct (service_role, lecture seule) le 15/08 avant d'écrire
-- cette migration : la table `profiles` ne contient AUJOURD'HUI que 10
-- lignes, toutes des membres réels du staff SportVision (créées entre le
-- 26 et le 29/07, avant le lancement du nouveau Connect personnel) — AUCUN
-- compte fantôme actif en ce moment. Ce correctif est donc préventif/
-- défense en profondeur pour l'état actuel de la base, mais reste
-- nécessaire : (1) les lignes `profiles` déjà supprimées par un futur
-- nettoyage manuel (Partie C de v58) ne protègent que RÉTROACTIVEMENT, un
-- nouveau compte fantôme resterait possible en cas de régression du
-- trigger, et (2) même après v58, un compte Connect personnel qui n'a
-- JAMAIS créé de ligne `player_profiles`/`connect_profile_settings` (signup
-- fait, mais aucune autre action — ni rejoint un club, ni enregistré ses
-- infos de profil) resterait un cas non couvert par le nettoyage manuel
-- suggéré en Partie C de v58 (son filtre ne cible que les lignes où l'une
-- de ces tables existe déjà) — point signalé séparément dans le rapport
-- d'audit, à valider par Fouka avant tout nettoyage.
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF
-- ────────────────────────────────────────────────────────────────────────
-- Remplace `exists (select 1 from profiles where id = auth.uid())` par
-- `is_staff()` dans les 25 policies listées, SANS changer aucune autre
-- condition (ex. `acteur_id = auth.uid() or acteur_id is null` sur
-- audit_logs, ou les clauses `auth.uid() = expediteur_id or ...` sur
-- messages restent identiques). Comportement inchangé pour tout membre
-- réel du staff (0 recoupement staff/memberships-player_profiles-
-- connect_profile_settings vérifié par v31 et reconfirmé par le contrôle
-- en direct ci-dessus) ; ferme l'accès pour tout compte Connect
-- personnel, passé ou futur, qui obtiendrait une ligne `profiles` par
-- erreur.
--
-- Idempotente (DROP POLICY IF EXISTS avant chaque CREATE), sans
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- les ~25 policies recréées par cette migration (audit_staff_insert,
-- dispo_select, doc_events_write, email_tpl_read, formation_rewards_read,
-- fsess_read, fc_select, kit_comp_select, kit_ctrl_items_select,
-- kit_ctrl_select, materiels_select, mc_read/write, mhist_read/insert,
-- ml_read/write, mlivr_read, mliv_read, mp_read, mval_read, mv_read/write,
-- msg_select, msg_update) existent toutes déjà en base. Cet en-tête
-- disait à tort "NON EXÉCUTÉE".
-- risque : ne fait que substituer un appel de fonction équivalent (mais
-- correctement filtré) à une sous-requête. Aucune table modifiée, aucune
-- donnée touchée.
-- ============================================================


-- ─── audit_logs ─────────────────────────────────────────────────────────
drop policy if exists "audit_staff_insert" on audit_logs;
create policy "audit_staff_insert" on audit_logs for insert with check (
  is_staff()
  and (acteur_id = auth.uid() or acteur_id is null)
);

-- ─── disponibilites ─────────────────────────────────────────────────────
drop policy if exists "dispo_select" on disponibilites;
create policy "dispo_select" on disponibilites for select using (
  is_staff()
);

-- ─── document_events ────────────────────────────────────────────────────
drop policy if exists "doc_events_write" on document_events;
create policy "doc_events_write" on document_events for insert with check (
  is_staff()
);

-- ─── email_templates ────────────────────────────────────────────────────
drop policy if exists "email_tpl_read" on email_templates;
create policy "email_tpl_read" on email_templates for select using (
  is_staff()
);

-- ─── formation_rewards ──────────────────────────────────────────────────
drop policy if exists "formation_rewards_read" on formation_rewards;
create policy "formation_rewards_read" on formation_rewards for select using (
  is_staff()
);

-- ─── formation_sessions ─────────────────────────────────────────────────
drop policy if exists "fsess_read" on formation_sessions;
create policy "fsess_read" on formation_sessions for select using (
  is_staff()
);

-- ─── formations_custom ──────────────────────────────────────────────────
drop policy if exists "fc_select" on formations_custom;
create policy "fc_select" on formations_custom for select using (
  is_staff()
);

-- ─── kit_compositions ───────────────────────────────────────────────────
drop policy if exists "kit_comp_select" on kit_compositions;
create policy "kit_comp_select" on kit_compositions for select using (
  is_staff()
);

-- ─── kit_controle_items ─────────────────────────────────────────────────
drop policy if exists "kit_ctrl_items_select" on kit_controle_items;
create policy "kit_ctrl_items_select" on kit_controle_items for select using (
  is_staff()
);

-- ─── kit_controles ──────────────────────────────────────────────────────
drop policy if exists "kit_ctrl_select" on kit_controles;
create policy "kit_ctrl_select" on kit_controles for select using (
  is_staff()
);

-- ─── materiels ──────────────────────────────────────────────────────────
drop policy if exists "materiels_select" on materiels;
create policy "materiels_select" on materiels for select using (
  is_staff()
);

-- ─── media_corrections ──────────────────────────────────────────────────
drop policy if exists "mc_read" on media_corrections;
create policy "mc_read" on media_corrections for select using (is_staff());

drop policy if exists "mc_write" on media_corrections;
create policy "mc_write" on media_corrections for all using (is_staff());

-- ─── media_historique ───────────────────────────────────────────────────
drop policy if exists "mhist_read" on media_historique;
create policy "mhist_read" on media_historique for select using (is_staff());

drop policy if exists "mhist_insert" on media_historique;
create policy "mhist_insert" on media_historique for insert with check (is_staff());

-- ─── media_liens (contient mot_de_passe_enc + confidentialite) ─────────
drop policy if exists "ml_read" on media_liens;
create policy "ml_read" on media_liens for select using (is_staff());

drop policy if exists "ml_write" on media_liens;
create policy "ml_write" on media_liens for all using (is_staff());

-- ─── media_livrables ────────────────────────────────────────────────────
drop policy if exists "mlivr_read" on media_livrables;
create policy "mlivr_read" on media_livrables for select using (is_staff());

-- ─── media_livraisons ───────────────────────────────────────────────────
drop policy if exists "mliv_read" on media_livraisons;
create policy "mliv_read" on media_livraisons for select using (is_staff());

-- ─── media_postproductions ──────────────────────────────────────────────
drop policy if exists "mp_read" on media_postproductions;
create policy "mp_read" on media_postproductions for select using (is_staff());

-- ─── media_validations ──────────────────────────────────────────────────
drop policy if exists "mval_read" on media_validations;
create policy "mval_read" on media_validations for select using (is_staff());

-- ─── media_versions ─────────────────────────────────────────────────────
drop policy if exists "mv_read" on media_versions;
create policy "mv_read" on media_versions for select using (is_staff());

drop policy if exists "mv_write" on media_versions;
create policy "mv_write" on media_versions for all using (is_staff());

-- ─── messages (messagerie interne staff, distincte de messages_client) ──
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


-- ============================================================
-- VÉRIFICATION POST-EXÉCUTION SUGGÉRÉE (lecture seule, ne rien exécuter
-- d'automatique ici) :
--   1. Confirmer qu'un compte staff réel (role admin/sec/prod/cm/compta/
--      com/photo, sans memberships/player_profiles/connect_profile_settings)
--      voit toujours ces 16 tables normalement — comportement inchangé
--      attendu, is_staff() couvre exactement le même ensemble de rôles que
--      les anciennes vérifications "any profiles row".
--   2. select count(*) from profiles; — si ce nombre a grandi au-delà des
--      10 lignes staff connues au moment d'écrire cette migration, vérifier
--      qu'aucune de ces nouvelles lignes n'est un compte Connect personnel
--      avant de considérer l'audit clos.
-- ============================================================
