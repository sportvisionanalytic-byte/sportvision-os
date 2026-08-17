-- ============================================================
-- SPORTVISION CLUB+ — Migration v44
-- Bascule org type `event` (+ event_kind) vers deux org types réellement
-- séparés : `tournoi` (tournament_organizer côté app) et `stage` (camp
-- côté app).
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Ne JAMAIS exécuter depuis un agent.
-- ============================================================
--
-- ── Contexte ────────────────────────────────────────────────────────────
-- migration-clubplus-v43-events-sessions.sql a construit event_editions/
-- event_sessions sur la base d'un seul org type `event` + un champ
-- organizations.event_kind ('tournoi'/'stage'). Fouka a ensuite reçu
-- HANDOFF-CLUBPLUS.md (17/08/2026), qui décrit une architecture différente :
-- deux org types RÉELLEMENT séparés (`tournament_organizer`, `camp` côté
-- HANDOFF ; `tournoi`, `stage` comme valeurs de organizations.
-- organization_type côté base, cohérent avec le vocabulaire déjà utilisé par
-- event_kind), pas un seul type avec un flag. Décision confirmée par Fouka :
-- basculer vers cette architecture pour suivre le handoff à la lettre.
--
-- ── Vérifié en direct par curl (REST, lecture seule, SUPABASE_URL/
--    SUPABASE_SECRET_KEY du .env racine) juste avant d'écrire cette migration ──
--   - organizations?select=organization_type -> uniquement 'projet' (95) et
--     'club' (26). Zéro ligne organization_type='event' à migrer.
--   - organizations?select=id,event_kind&limit=1 -> 200, {"event_kind":null}
--     -> la colonne event_kind EXISTE déjà : migration-clubplus-v43 a bien
--     été exécutée entre-temps (malgré son en-tête "NON EXÉCUTÉE" resté
--     inchangé dans le fichier source, qui n'a pas vocation à être modifié
--     après coup) -> la colonne doit être supprimée ici.
--   - event_editions?select=id&limit=1 et event_sessions?select=id&limit=1
--     -> 200 [] tous les deux (à distinguer d'une table absente, qui renvoie
--     une 404 PGRST205 — vérifié sur un nom de table bidon en comparaison) :
--     les deux tables existent, 0 ligne. Aucun changement de schéma
--     nécessaire sur ces deux tables elles-mêmes : organization_id référence
--     organizations(id) quel que soit organization_type de la ligne pointée,
--     et elles ne lisent/écrivent jamais organization_type ni event_kind.
--   - organization_role_catalog?organization_type=eq.event -> 2 lignes
--     ('responsable', is_admin=true ; 'partenaire', is_admin=false,
--     is_default=true) -> migration-connect-v20 a bien été exécutée ; ces 2
--     lignes existent et sont dupliquées sous 'tournoi'/'stage' puis
--     supprimées.
--   - connect_org_activation_tokens?select=id,organization_type -> 200 [] :
--     table existante, 0 ligne. Contrainte actuelle (migration-connect-v20,
--     "check (organization_type in ('event','cm_agency'))") -> 0 ligne à
--     migrer, 'event' peut être retiré de la contrainte sans casse.
--
-- Idempotente. À exécuter après migration-connect-v20-event-cm-agency-org-
-- types.sql et migration-clubplus-v43-events-sessions.sql (toutes deux déjà
-- exécutées d'après les vérifications ci-dessus).
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. organizations.organization_type — 'event' -> 'tournoi' / 'stage'
-- ═══════════════════════════════════════════════════════════════
-- 0 ligne organization_type='event' en prod (vérifié ci-dessus) : pas
-- d'UPDATE de données nécessaire, seulement la contrainte.

alter table organizations drop constraint if exists organizations_organization_type_check;
alter table organizations add constraint organizations_organization_type_check
  check (organization_type in ('club','academie','coach','projet','sponsor','tournoi','stage','cm_agency'));


-- ═══════════════════════════════════════════════════════════════
-- 2. organizations.event_kind — supprimée
-- ═══════════════════════════════════════════════════════════════
-- Le type d'organisation ('tournoi' vs 'stage') porte désormais directement
-- l'information que event_kind encodait auparavant sur un seul type 'event' :
-- le flag séparé n'a plus lieu d'être.

alter table organizations drop constraint if exists organizations_event_kind_check;
alter table organizations drop column if exists event_kind;


-- ═══════════════════════════════════════════════════════════════
-- 3. organization_role_catalog — presets 'tournoi'/'stage', retrait 'event'
-- ═══════════════════════════════════════════════════════════════
-- Mêmes presets que 'event' (migration-connect-v20), dupliqués sous les 2
-- nouvelles clés. Label adapté pour 'stage' ("Responsable stage" plutôt que
-- "Responsable événement") ; 'partenaire' inchangé (rôle non-admin par
-- défaut, pertinent dans les deux cas).

insert into organization_role_catalog (organization_type, role_key, label, is_admin, is_default) values
  ('tournoi', 'responsable', 'Responsable événement', true, false),
  ('tournoi', 'partenaire', 'Partenaire', false, true),
  ('stage', 'responsable', 'Responsable stage', true, false),
  ('stage', 'partenaire', 'Partenaire', false, true)
on conflict (organization_type, role_key) do nothing;

-- Les 2 lignes 'event' (migration-connect-v20) n'ont plus de type
-- d'organisation valide pour les porter (contrainte organizations.
-- organization_type_check ne permet plus 'event' depuis la section 1) :
-- suppression plutôt que laisser une entrée de catalogue orpheline.
delete from organization_role_catalog where organization_type = 'event';


-- ═══════════════════════════════════════════════════════════════
-- 4. connect_org_activation_tokens.organization_type — 'event' -> 'tournoi'/'stage'
-- ═══════════════════════════════════════════════════════════════
-- 0 ligne existante (vérifié ci-dessus) : pas d'UPDATE de données
-- nécessaire, seulement la contrainte. Le nom de contrainte suit la
-- convention Postgres par défaut (<table>_<colonne>_check), déjà observée
-- sur organizations_organization_type_check ; `drop constraint if exists`
-- rend l'opération sûre même si le nom réel diffère légèrement.

alter table connect_org_activation_tokens drop constraint if exists connect_org_activation_tokens_organization_type_check;
alter table connect_org_activation_tokens add constraint connect_org_activation_tokens_organization_type_check
  check (organization_type in ('tournoi','stage','cm_agency'));


-- ============================================================
-- Vérification manuelle suggérée après exécution
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'organizations_organization_type_check';
-- -> doit lister 'tournoi','stage', plus AUCUNE trace de 'event'.
--
-- select column_name from information_schema.columns
--  where table_name = 'organizations' and column_name = 'event_kind';
-- -> doit renvoyer 0 ligne.
--
-- select organization_type, role_key from organization_role_catalog
--  where organization_type in ('event','tournoi','stage') order by 1,2;
-- -> doit renvoyer 4 lignes (stage x2, tournoi x2), 0 pour 'event'.
--
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'connect_org_activation_tokens_organization_type_check';
-- -> doit lister 'tournoi','stage','cm_agency', plus AUCUNE trace de 'event'.
--
-- NOTE — ce qui reste hors périmètre de cette migration
-- event_editions / event_sessions (migration-clubplus-v43) ne référencent
-- jamais organization_type ni event_kind directement (seulement
-- organization_id -> organizations(id)) : aucun changement de schéma
-- nécessaire sur ces deux tables, elles restent valides telles quelles quel
-- que soit le nouveau organization_type ('tournoi' ou 'stage') de
-- l'organisation qu'elles référencent.
-- ============================================================
