-- ============================================================
-- SPORTVISION CLUB+ — Migration v54 (03/09/2026)
-- Suite de migration-clubplus-v1 à v53.sql. Idempotente.
--
-- Chantier Fouka du 03/09/2026 : relier équipes ↔ matchs/calendrier/production. club_matches a
-- déjà une vraie FK team_id + RLS équipe-level via is_team_educateur() depuis
-- migration-clubplus-v37-team-scoping-statuts-liaison.sql — club_calendar_events était resté sur
-- le même modèle texte libre (`team`) que club_matches AVANT v37, avec le même trou de sécurité :
-- ccal_member_select/ccal_member_insert n'ont aucune notion d'équipe, un coach scoped à U15 voit
-- et écrit aujourd'hui les événements de TOUTES les équipes du club. Corrigé ici en appliquant
-- exactement le même patron que v37 (team_id référençant la VRAIE club_teams, RLS via
-- is_team_educateur() déjà existante, aucune nouvelle fonction).
--
-- ccal_family_select / ccal_player_select (déjà en place) résolvent déjà l'équipe par
-- correspondance de NOM (club_teams.name = club_calendar_events.team) — laissées inchangées dans
-- cette migration : elles fonctionnent, les toucher est hors périmètre de ce chantier (le
-- vrai trou concerné est côté staff/coach, pas côté famille/joueur).
--
-- ─── Vérification des données réelles avant migration (03/09/2026) ────────────────────────────
--   - club_calendar_events        : 0 ligne en prod.
--   - club_calendar_events.team non vide : 0 ligne.
--   - club_teams                  : 0 ligne en prod.
-- Rien à backfiller aujourd'hui — bloc 1 écrit de façon générique et idempotente (au cas où des
-- données apparaîtraient entre cette rédaction et l'exécution), correspondance EXACTE par nom
-- d'équipe (club_id + team = club_teams.name), jamais de rapprochement flou. Si un événement
-- référence un nom d'équipe absent de club_teams, team_id reste NULL — comportement volontaire
-- identique à v37 (team_id NULL = visible par tout membre du club, comportement actuel inchangé).
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. team_id sur club_calendar_events (référence club_teams existante) + backfill par
--    correspondance de nom
-- ────────────────────────────────────────────────────────────────────────

alter table club_calendar_events add column if not exists team_id uuid references club_teams(id);

create index if not exists idx_ccal_team on club_calendar_events(team_id);

update club_calendar_events e
set team_id = t.id
from club_teams t
where e.team_id is null
  and e.team is not null and trim(e.team) <> ''
  and t.club_id = e.club_id and t.name = trim(e.team);

-- ────────────────────────────────────────────────────────────────────────
-- 2. RLS équipe-level staff — réutilise is_team_educateur() (migration-clubplus-v13.sql), même
--    patron que cma_member_select/insert (v37). ccal_admin_delete, ccal_family_select,
--    ccal_player_select, ccal_staff_select ne bougent pas.
-- ────────────────────────────────────────────────────────────────────────

drop policy if exists "ccal_member_select" on club_calendar_events;
create policy "ccal_member_select" on club_calendar_events for select using (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

drop policy if exists "ccal_member_insert" on club_calendar_events;
create policy "ccal_member_insert" on club_calendar_events for insert with check (
  is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
);

-- Pas de politique UPDATE avant cette migration (les événements ne sont ni modifiés ni assignés
-- après création dans l'UI actuelle, seulement créés/supprimés) — cohérent, non ajoutée ici.

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select count(*) from club_calendar_events where team_id is not null;  -- probablement 0
--
-- select policyname, cmd, qual, with_check from pg_policies
-- where tablename = 'club_calendar_events' order by cmd;
--
-- Puis, avec un compte club existant (role='admin', teams=[]) :
-- vérifier que /calendar et l'onboarding affichent toujours exactement les mêmes lignes qu'avant
-- cette migration (aucune régression, team_id étant NULL partout aujourd'hui, is_team_educateur()
-- n'entre jamais en jeu pour les données actuelles).
-- ============================================================
