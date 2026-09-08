-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1b — Appliquer le perimetre aux tables de fonctionnement d'un club
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Une policy RESTRICTIVE se combine en ET avec toutes les autres : elle ne peut que RETIRER de
-- l'acces. Chacune de celles-ci commence par « ou bien vous n'etes pas un CM » : pour un admin,
-- un comptable ou un photographe, la condition est vraie et rien ne change. Seul un CM voit son
-- perimetre se refermer sur ses clubs.
--
-- Toutes passent par cm_clubs_autorises(). Aucune ne reecrit la regle.

begin;

-- ── Le club lui-meme, et son organisation ────────────────────────────────────
drop policy if exists cm_perim_clubs on clubs;
create policy cm_perim_clubs on clubs as restrictive for all to authenticated
  using (not est_cm_cloisonne() or id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or id in (select cm_clubs_autorises()));

-- organizations porte aussi les projets et les agences : un CM ne doit voir que les clubs qui
-- lui sont affectes, et rien des 158 projets ni des autres organisations.
drop policy if exists cm_perim_organizations on organizations;
create policy cm_perim_organizations on organizations as restrictive for all to authenticated
  using (not est_cm_cloisonne() or id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or id in (select cm_clubs_autorises()));

-- ── La structure sportive ────────────────────────────────────────────────────
drop policy if exists cm_perim_club_teams on club_teams;
create policy cm_perim_club_teams on club_teams as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_club_members on club_members;
create policy cm_perim_club_members on club_members as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

-- ── Les personnes rattachees : affiliations et demandes ──────────────────────
-- memberships porte organization_id, qui vaut l'id du club (organizations.id = clubs.id).
drop policy if exists cm_perim_memberships on memberships;
create policy cm_perim_memberships on memberships as restrictive for all to authenticated
  using (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_membership_requests on membership_requests;
create policy cm_perim_membership_requests on membership_requests as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_coach_players on coach_players;
create policy cm_perim_coach_players on coach_players as restrictive for all to authenticated
  using (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_club_presences on club_presences;
create policy cm_perim_club_presences on club_presences as restrictive for all to authenticated
  using (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()));

-- ── Les invitations et les liens diffuses ────────────────────────────────────
drop policy if exists cm_perim_player_invitations on player_invitations;
create policy cm_perim_player_invitations on player_invitations as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_parent_invitations on parent_invitations;
create policy cm_perim_parent_invitations on parent_invitations as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_team_invite_codes on team_invite_codes;
create policy cm_perim_team_invite_codes on team_invite_codes as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

-- ── L'onboarding et le calendrier du club ────────────────────────────────────
drop policy if exists cm_perim_onboarding on club_onboarding_progress;
create policy cm_perim_onboarding on club_onboarding_progress as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_club_calendar on club_calendar_events;
create policy cm_perim_club_calendar on club_calendar_events as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

commit;

-- ── L'inventaire de la dette ─────────────────────────────────────────────────
-- Ce qui reste ouvert a tous les clubs pour un CM, uniquement parce que le role `cm` figure
-- encore dans is_staff(). Cette liste est le plan de fermeture : elle se consulte, elle ne
-- s'oublie pas dans un fichier de notes.
create or replace function public.cm_surfaces_heritees()
returns table(surface text, operation text, deja_cloisonnee boolean)
language sql
stable
set search_path to 'public'
as $function$
  select p.tablename::text,
         p.cmd::text,
         exists (
           select 1 from pg_policies r
           where r.tablename = p.tablename and r.policyname like 'cm_perim_%'
         )
  from pg_policies p
  where coalesce(p.qual,'')||coalesce(p.with_check,'') ilike '%is_staff()%'
  order by 3, 1, 2;
$function$;

comment on function public.cm_surfaces_heritees() is
  'DETTE P1 TRANSITOIRE. Les surfaces encore accessibles a un CM sur TOUS les clubs, du seul fait que le role cm appartient a is_staff(). A fermer ecran par ecran ; quand deja_cloisonnee est vrai partout, le role cm peut sortir de is_staff().';

select count(*) filter (where not deja_cloisonnee) as a_fermer,
       count(*) filter (where deja_cloisonnee)     as deja_cloisonnees
from cm_surfaces_heritees();
