-- ============================================================
-- SPORTVISION CLUB+ — Migration v43
-- Suite de migration-clubplus-v1 à v42.sql. Idempotente.
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Ne JAMAIS exécuter depuis un agent.
-- ============================================================
--
-- Brief Fouka 17/08/2026 (CLUB-PLUS-PRODUCT-BIBLE.md §14 "Interface Tournoi /
-- Événement" / §15 "Interface Stage / Camp") : construction des deux objets
-- centraux décrits par la Bible pour l'org type `event` — "Édition" (§14,
-- organisateur de tournoi) et "Session" (§15, organisateur de stage/camp).
--
-- ── Aucune organisation réelle n'a le type `event` aujourd'hui ────────────
-- Vérifié en direct par curl (REST, lecture seule, SUPABASE_URL/
-- SUPABASE_SECRET_KEY du .env racine) juste avant ce brief :
-- `organizations?select=organization_type` -> seulement 'projet' (95) et
-- 'club' (26). Zéro compte réel à casser sur ce périmètre — la rigueur de
-- vérification du schéma reste la même.
--
-- ── Décision d'architecture (confirmée par Fouka en cours de chantier) ────
-- Stage/Camp NE devient PAS un nouvel OrgType : il réutilise l'org type
-- `event` existant (déjà mappé côté design, ORG_TYPE_MAP dans
-- app-next/src/lib/supabase/mappers.ts), distingué par un simple champ sur
-- l'organisation (`organizations.event_kind`) plutôt qu'un type dédié — un
-- organisateur `event` est SOIT un organisateur de tournoi (event_kind =
-- 'tournoi', valeur par défaut retenue côté app pour NULL, voir mapEventKind
-- dans mappers.ts) SOIT un organisateur de stage/camp (event_kind = 'stage'),
-- jamais les deux. Conséquence : deux tables distinctes plutôt qu'une seule
-- table polymorphe — "Édition" (bilan léger, équipes participantes) et
-- "Session" (groupes, participants) ont des champs assez différents pour que
-- les mélanger dans une seule table aurait forcé la moitié des colonnes à
-- rester NULL selon le sous-type, sans bénéfice réel.
--
-- ── Vérifié en direct avant d'écrire cette migration ───────────────────────
--   - `organizations?select=*&limit=1` -> colonnes réelles : id,
--     organization_type, nom, ville, legacy_client_id, legacy_club_id,
--     legacy_type_client, statut, created_at, updated_at, credits_balance,
--     credits_reserved, logo_url. Aucune colonne `event_kind`/`nature`/`kind`
--     existante -> à ajouter.
--   - Aucune table `event_editions`/`club_events`/`event_sessions` existante
--     (OpenAPI Supabase, endpoint racine PostgREST) -> noms libres.
--   - `requests` (ServiceRequest), `contenus` (Content), `devis`/`factures`/
--     `contrats` (Documents) N'ONT AUCUNE colonne de rattachement à un
--     événement/édition (ni `event_id`, ni équivalent) — vérifié sur le
--     schéma OpenAPI complet. Décision : NE PAS ajouter de colonne de
--     rattachement sur ces quatre tables de production dans cette migration.
--     La Bible (§14 : "si c'est raisonnable") laisse le choix ; ces tables
--     sont consommées par de nombreux autres écrans/agents (Communication,
--     Facturation, Contrats...) et un rattachement correct nécessiterait de
--     revoir leur RLS et leurs mappers — hors périmètre "léger" de ce
--     chantier. Une édition/session reste donc identifiable par son nom/sa
--     date dans un brief manuel, pas par une jointure automatique. À
--     reconsidérer séparément si un vrai besoin (ex. filtrer "Mes contenus"
--     par édition) émerge.
--   - `is_org_member(p_org_id uuid)`, `is_org_admin(p_organization_id uuid)`
--     et `is_staff()` existent déjà (migration-connect-v2 et v6) — réutilisés
--     tels quels, non redéfinis ici.
--   - `organization_role_catalog` a déjà pour organization_type='event' :
--     'responsable' (is_admin=true) et 'partenaire' (is_admin=false,
--     is_default) — migration-connect-v20. is_org_admin() résout donc déjà
--     correctement "qui peut créer/modifier une édition ou une session" pour
--     ce type d'organisation, sans rien ajouter au catalogue.
--
-- ── Modèle ──────────────────────────────────────────────────────────────
-- `event_editions` (§14) : un organisateur de tournoi peut piloter PLUSIEURS
-- éditions ("Mes événements" au pluriel dans la Bible) — scope par
-- organization_id, pas un singleton par organisation (contrairement à
-- event_checklist_items, qui reste un outil différent : suivi de préparation
-- d'UN événement, inchangé par cette migration). "Équipes participantes
-- facultatives et légères" (§14) : un simple tableau jsonb de noms, pas de
-- table de poules/inscriptions (Bible : "Club+ ne doit pas devenir un
-- logiciel d'inscription, de poules ou de classement"). Bilan léger :
-- vainqueur/finaliste/score finale/MVP/distinctions, tous nullable, rien
-- d'obligatoire (§14 : "ne pas créer poules, bracket, classement complet").
--
-- `event_sessions` (§15) : objet central "Session" d'un organisateur de
-- stage/camp. Groupes et participants stockés en jsonb (tableaux de noms),
-- PAS une vraie table de personnes/inscriptions — Bible : "Participants...
-- uniquement pour organiser contenus, albums et intervention SportVision",
-- "Ne pas construire la gestion complète des inscriptions et paiements du
-- camp". Aucun rattachement à un compte Connect/AthleteAffiliation : ce sont
-- des noms libres saisis par l'organisateur pour briefer SportVision, pas des
-- comptes.
--
-- ── RLS ─────────────────────────────────────────────────────────────────
-- Lecture : membre actif de l'organisation (is_org_member) ou staff
-- (is_staff) — même patron que event_checklist_items (migration-connect-v22).
-- Écriture (insert/update/delete) : admin de l'organisation (is_org_admin,
-- résout déjà 'responsable' pour le type 'event' via organization_role_catalog)
-- ou staff. Contrairement à event_checklist_items (où seul le staff écrit,
-- le client consulte), ici c'est l'organisateur lui-même qui pilote sa fiche
-- événement/session — cohérent avec la Bible §14 "Fiche événement" et §6
-- "Aperçu, statut" décrits comme des informations que la structure renseigne.
--
-- Idempotente (create table if not exists, drop policy if exists avant
-- chaque create, add column if not exists). À exécuter après
-- migration-connect-v2-organizations-entitlements.sql (is_org_member,
-- is_staff) et migration-connect-v6-org-admin.sql (is_org_admin).
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. organizations.event_kind — distingue tournoi vs stage/camp pour le
--    seul type d'organisation 'event'. NULL = 'tournoi' côté app
--    (mapEventKind, app-next/src/lib/supabase/mappers.ts) : les organisations
--    'event' déjà en base (aucune à ce jour) ne changent pas de comportement.
-- ═══════════════════════════════════════════════════════════════

alter table organizations add column if not exists event_kind text;

alter table organizations drop constraint if exists organizations_event_kind_check;
alter table organizations add constraint organizations_event_kind_check
  check (event_kind is null or event_kind in ('tournoi', 'stage'));


-- ═══════════════════════════════════════════════════════════════
-- 2. event_editions — §14 "Interface Tournoi / Événement"
-- ═══════════════════════════════════════════════════════════════

create table if not exists event_editions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  nom text not null,
  date_debut date,
  date_fin date,
  lieu text,
  sport text,
  format text,
  contact_nom text,
  contact_email text,
  contact_telephone text,
  statut text not null default 'a_venir' check (statut in ('a_venir', 'en_cours', 'terminee', 'annulee')),
  -- Bloc libre "Informations utiles SportVision" (§14 : volume participants/
  -- équipes, terrains, horaires clés, finale/remise récompenses) : un seul
  -- champ texte plutôt que 4-5 colonnes dédiées, pour rester "léger" —
  -- aucune de ces informations n'est structurée ni exploitée par un calcul,
  -- c'est un bloc de contexte pour le CM/la production.
  infos_utiles text,
  -- Liste de noms libres, jamais une table de poules/inscriptions (§14).
  equipes_participantes jsonb not null default '[]'::jsonb,
  bilan_vainqueur text,
  bilan_finaliste text,
  bilan_score_finale text,
  bilan_mvp text,
  bilan_distinctions text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_editions_org on event_editions(organization_id);

alter table event_editions enable row level security;

drop policy if exists "ee_select" on event_editions;
create policy "ee_select" on event_editions for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "ee_admin_write" on event_editions;
create policy "ee_admin_write" on event_editions for all using (
  is_org_admin(organization_id) or is_staff()
) with check (
  is_org_admin(organization_id) or is_staff()
);


-- ═══════════════════════════════════════════════════════════════
-- 3. event_sessions — §15 "Interface Stage / Camp"
-- ═══════════════════════════════════════════════════════════════

create table if not exists event_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  nom text not null,
  date_debut date,
  date_fin date,
  lieu text,
  statut text not null default 'a_venir' check (statut in ('a_venir', 'en_cours', 'terminee', 'annulee')),
  infos_utiles text,
  -- Listes de noms libres (groupes, participants) — jamais un système
  -- d'inscription/paiement de stage (§15, exclu explicitement par la Bible).
  groupes jsonb not null default '[]'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_sessions_org on event_sessions(organization_id);

alter table event_sessions enable row level security;

drop policy if exists "es_select" on event_sessions;
create policy "es_select" on event_sessions for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "es_admin_write" on event_sessions;
create policy "es_admin_write" on event_sessions for all using (
  is_org_admin(organization_id) or is_staff()
) with check (
  is_org_admin(organization_id) or is_staff()
);


-- ============================================================
-- Vérification manuelle suggérée après exécution
-- select column_name from information_schema.columns
--  where table_name = 'organizations' and column_name = 'event_kind';
-- -> doit renvoyer 1 ligne.
-- select table_name from information_schema.tables
--  where table_name in ('event_editions', 'event_sessions');
-- -> doit renvoyer 2 lignes.
--
-- NOTE — ce qui reste hors périmètre de cette migration
--
-- Pas de trigger updated_at automatique sur ces deux tables : posé
-- explicitement par l'app à chaque update (même choix pragmatique que
-- plusieurs tables Club+ récentes, pas de fonction generic_set_updated_at()
-- réutilisable trouvée dans les migrations existantes).
--
-- Pas de contrainte qui empêche de créer une event_editions/event_sessions
-- sur une organisation dont organization_type != 'event' : cohérent avec le
-- reste du schéma (aucune table Club+ existante ne valide le type
-- d'organisation par contrainte SQL, toujours par filtre applicatif) — le
-- gate réel est côté app-next (organization.type === "event" dans
-- events/page.tsx et campsessions/page.tsx).
-- ============================================================
