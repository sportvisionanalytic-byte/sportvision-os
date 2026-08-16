-- ============================================================
-- SPORTVISION CLUB+ — Migration v37 (corrigée le 16/08, voir note ci-dessous)
-- Suite de migration-clubplus-v1 à v36.sql. Idempotente.
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF — version précédente cassée, jamais appliquée
-- ────────────────────────────────────────────────────────────────────────
-- La première version de cette migration a échoué à l'exécution
-- ("column nom of relation club_teams does not exist") : elle supposait
-- `club_teams` inexistante et tentait de la créer avec une colonne `nom`,
-- alors que cette table existe DÉJÀ depuis migration-clubplus-v5.sql, avec
-- une colonne `name` (pas `nom`) et une structure bien plus riche (section,
-- coach, resp_comm, members, next_match, couleur). L'éditeur SQL Supabase
-- exécute le script collé comme une seule transaction implicite : l'échec
-- sur cette instruction a tout annulé, RIEN de cette migration n'a été
-- appliqué (vérifié en direct après coup : club_member_teams, team_id,
-- verified_by/at, request_id — absents des 4 tables concernées).
--
-- Découverte en creusant plus loin : migration-clubplus-v13.sql a DÉJÀ
-- construit tout le nécessaire pour un vrai cloisonnement par équipe —
-- `team_memberships` (roster joueurs) ET surtout `is_team_educateur
-- (p_team_id)`, une fonction SECURITY DEFINER qui vérifie déjà : Admin =
-- accès total, Coach/resp_equipe = vérifié via club_members.teams (le
-- tableau JSONB texte libre existant) comparé au vrai nom dans club_teams.
-- Cette fonction est DÉJÀ utilisée par les RLS de team_memberships,
-- membership_requests et parent_invitations (v13/v14) — juste jamais
-- appliquée à club_bookings/club_matches, qui restaient sur is_club_member
-- (organisation entière) sans distinction d'équipe.
--
-- Cette version corrigée NE CRÉE PLUS club_teams ni de nouvelle table de
-- liaison club_member_teams (les deux étaient une duplication inutile de
-- ce qui existe déjà) — elle se contente d'ajouter team_id (référençant la
-- VRAIE club_teams) sur club_bookings/club_matches et de réutiliser
-- is_team_educateur() pour la RLS. Périmètre net plus petit et plus sûr
-- que la version initiale, cohérent avec la consigne de la Product Bible
-- "réutiliser avant de créer".
--
-- Corrige toujours les mêmes trous identifiés par les 2 audits produit/
-- sécurité Club+ du 16/08/2026 (voir CLUB-PLUS-PRODUCT-BIBLE.md
-- §5/§8/§16/§17/§18/§24) :
--
--   1. Scope équipe réel sur club_bookings/club_matches (team_id + RLS via
--      is_team_educateur, déjà existante — pas recréée).
--   2. Statuts manquants : 'annulee' sur club_bookings.status ; 'reportee'
--      et 'annulee' sur club_matches.status ; verified_by/verified_at sur
--      club_matches pour le futur workflow de vérification Directeur
--      sportif (§8, optionnel selon requires_result_verification — non
--      implémenté dans cette migration, seulement les colonnes).
--   3. Lien club_requests <-> contenus (request_id sur contenus), pour que
--      "brief envoyé" et "contenu en production/validation" redeviennent
--      progressivement un seul objet traçable (§3 règle de non duplication,
--      §17), sans dupliquer ni fusionner les deux tables dans ce chantier.
--
-- ─── Vérification des données réelles avant migration (16/08/2026, ré-
--     vérifiée après le premier échec) ─────────────────────────────────
--   - club_teams          : 0 ligne en prod.
--   - club_bookings.team  : 1 seule ligne existante, team = NULL.
--   - club_members.teams  : 4 lignes, toutes role='admin', teams = '[]'.
--   - club_matches        : 0 ligne.
-- Rien à backfiller aujourd'hui — le bloc 1 reste écrit de façon générique
-- et idempotente (au cas où des données apparaîtraient entre cette
-- rédaction et l'exécution), avec correspondance EXACTE par nom d'équipe
-- (club_id + team = club_teams.name), jamais de rapprochement flou. Si une
-- réservation/un match référence un nom d'équipe qui n'existe PAS encore
-- dans club_teams (table gérée par l'admin, jamais auto-peuplée par cette
-- migration), team_id reste NULL — comportement volontaire, pas une
-- erreur : voir bloc 2, team_id NULL = visible par tout membre du club,
-- exactement le comportement actuel.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL
-- Editor. Ne JAMAIS exécuter depuis un agent.
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. team_id sur club_bookings / club_matches (référence club_teams
--    existante) + backfill par correspondance de nom
-- ────────────────────────────────────────────────────────────────────────

alter table club_bookings add column if not exists team_id uuid references club_teams(id);
alter table club_matches add column if not exists team_id uuid references club_teams(id);

create index if not exists idx_cbk_team on club_bookings(team_id);
create index if not exists idx_cma_team on club_matches(team_id);

-- Backfill idempotent (no-op aujourd'hui, club_teams étant vide) : ne
-- rattache que si une équipe de CE nom existe déjà dans club_teams pour CE
-- club — ne crée jamais de ligne club_teams depuis cette migration (table
-- gérée par l'admin, voir data/club/teams.ts).
update club_bookings b
set team_id = t.id
from club_teams t
where b.team_id is null
  and b.team is not null and trim(b.team) <> ''
  and t.club_id = b.club_id and t.name = trim(b.team);

update club_matches m
set team_id = t.id
from club_teams t
where m.team_id is null
  and m.team is not null and trim(m.team) <> ''
  and t.club_id = m.club_id and t.name = trim(m.team);

-- ────────────────────────────────────────────────────────────────────────
-- 2. RLS équipe-level — réutilise is_team_educateur() (migration-clubplus-
--    v13.sql), déjà en place et déjà utilisée ailleurs (team_memberships,
--    membership_requests, parent_invitations). Aucune nouvelle fonction.
-- ────────────────────────────────────────────────────────────────────────

-- ── club_bookings : select + insert (le pipeline lui-même reste piloté
--    par is_club_admin/le staff, inchangé — cbk_admin_update, cbk_admin_
--    delete, cbk_staff_select, cbk_staff_update ne bougent pas). ──

drop policy if exists "cbk_member_select" on club_bookings;
create policy "cbk_member_select" on club_bookings for select using (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

drop policy if exists "cbk_member_insert" on club_bookings;
create policy "cbk_member_insert" on club_bookings for insert with check (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

-- ── club_matches : select + insert + update (cma_member_update est le
--    chemin de saisie de résultat par le coach — c'est le cas d'usage exact
--    du finding de sécurité, un coach scoped ne doit pouvoir ni lire ni
--    écrire un match d'une autre équipe. cma_admin_delete reste admin-only,
--    inchangé). ──

drop policy if exists "cma_member_select" on club_matches;
create policy "cma_member_select" on club_matches for select using (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

drop policy if exists "cma_member_insert" on club_matches;
create policy "cma_member_insert" on club_matches for insert with check (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

drop policy if exists "cma_member_update" on club_matches;
create policy "cma_member_update" on club_matches for update using (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

-- ── club_requests / club_media / club_creations : PAS de team_id, PAS de
--    RLS équipe-level dans cette migration. Les 3 ont bien une colonne
--    `team` texte libre (facultative), mais aucune n'est un objet
--    systématiquement lié à une équipe précise :
--      - club_requests.team  : une demande peut concerner un sponsor, un
--        document, une info structure entière — le champ existe pour les
--        cas où c'est pertinent, pas pour tous les cas.
--      - club_media.team / club_creations.team : idem, une bonne partie du
--        contenu (logo club, affiche générale, sponsor) n'est d'aucune
--        équipe en particulier.
--    Forcer une frontière RLS équipe-level dessus masquerait par erreur des
--    objets légitimement organisation-wide à un coach scoped. Décision :
--    laissés inchangés (is_club_member(club_id) reste la seule frontière).
--    À revisiter si un jour ces objets deviennent systématiquement liés à
--    une équipe (hors périmètre de ce chantier).
-- ────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────
-- 3. Statuts manquants
-- ────────────────────────────────────────────────────────────────────────

-- club_bookings.status : ajoute 'annulee' (cancel_request est une
-- permission de base, §5/§16, mais le statut manquait à la contrainte).
alter table club_bookings drop constraint if exists club_bookings_status_check;
alter table club_bookings add constraint club_bookings_status_check check (status in (
  'recue','qualifiee','confirmee','operateur_affecte','mission_realisee','livree','annulee'
));

-- club_matches.status : ajoute 'reportee' et 'annulee' (§8/§18 : "Statut :
-- terminé, reporté, annulé") + verified_by/verified_at pour le futur
-- workflow de vérification Directeur sportif (§8 — optionnel selon
-- requires_result_verification, non implémenté ici, colonnes seulement).
alter table club_matches drop constraint if exists club_matches_status_check;
alter table club_matches add constraint club_matches_status_check check (status in (
  'a_venir','a_transmettre','recu','reportee','annulee'
));

alter table club_matches add column if not exists verified_by uuid references auth.users on delete set null;
alter table club_matches add column if not exists verified_at timestamptz;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Lien club_requests <-> contenus
-- ────────────────────────────────────────────────────────────────────────

-- Nullable : un contenu peut exister sans venir d'une demande explicite
-- (ex. contenu spontané SportVision, ou contenu produit hors tout brief
-- club formalisé). Pas de nouvelle UI dans ce chantier — seulement la
-- colonne, exploitable plus tard sans nouvelle migration.
alter table contenus add column if not exists request_id uuid references club_requests(id) on delete set null;

create index if not exists idx_contenus_request on contenus(request_id);

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select count(*) from club_bookings where team_id is not null;  -- probablement 0
-- select count(*) from club_matches where team_id is not null;   -- probablement 0
--
-- select policyname, cmd, qual from pg_policies
-- where tablename in ('club_bookings','club_matches') order by tablename, cmd;
--
-- Puis, avec un compte club existant (role='admin', teams=[]) :
-- vérifier que /services et /matchcenter affichent toujours exactement les
-- mêmes lignes qu'avant cette migration (aucune régression, team_id étant
-- NULL partout, is_team_educateur() n'entre jamais en jeu pour les données
-- actuelles).
-- ============================================================
