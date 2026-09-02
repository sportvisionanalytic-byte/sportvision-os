-- ============================================================================
-- migration-clubplus-v49-fix-fuite-calendrier-famille.sql
-- Addendum critique de Fouka (02/09/2026) sur la relation Club+/Connect/
-- joueurs/parents ("§31 RLS CRITIQUE : tester réellement club A vs club B,
-- U15 vs U18") — le document d'architecture d'origine (CLUBPLUS_PLAYER_
-- FAMILY_ARCHITECTURE.md/SECURITY_REVIEW.md, 2026-08-04) listait ces tests
-- comme recommandés mais jamais exécutés faute d'accès direct à la base.
-- Exécutés ce soir avec des comptes jetables : isolation inter-club OK
-- (club_teams, membership_requests, club_family_identity*), isolation
-- inter-équipe OK sur club_media/club_creations (is_media_visible_to_family,
-- correctement scopé media_access_rules -> team_memberships) et club_matches
-- (cma_family_select correctement scopé par team_id) — MAIS FUITE RÉELLE
-- confirmée sur club_calendar_events : un parent/joueur affilié uniquement à
-- l'équipe U15 d'un club voyait aussi les événements tagués 'U18' du même
-- club.
--
-- Cause : ccal_player_select ne vérifiait que l'appartenance au CLUB
-- (player_profiles.club_id), jamais l'équipe de l'événement — contrairement
-- à ccal_family_select (qui existe déjà, correctement scopée par équipe,
-- mais ajoutait une autorisation SUPPLÉMENTAIRE sans jamais restreindre la
-- permissive ccal_player_select : en RLS Postgres, les policies SELECT
-- multiples sont combinées en OR, donc la plus permissive des deux
-- l'emportait silencieusement).
--
-- Correctif : ccal_player_select restreinte au club-large UNIQUEMENT pour
-- les événements sans équipe ciblée (team is null — cohérent avec l'addendum
-- §19 : "Un événement Club+ doit pouvoir cibler tout le club, une catégorie,
-- une équipe, plusieurs équipes"), sinon exige la même vérification
-- d'équipe que ccal_family_select. ccal_family_select n'est pas supprimée
-- (légèrement redondante désormais mais inoffensive, et couvre un cas que
-- le correctif ne couvre pas : elle n'exige pas account_status <> 'retire').
-- ============================================================================

drop policy if exists "ccal_player_select" on public.club_calendar_events;
create policy "ccal_player_select" on public.club_calendar_events for select using (
  exists (
    select 1 from public.player_profiles pp
    where pp.club_id = club_calendar_events.club_id
      and pp.account_status <> 'retire'
      and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
  )
  and (
    club_calendar_events.team is null
    or exists (
      select 1 from public.club_teams ct
      where ct.club_id = club_calendar_events.club_id
        and ct.name = club_calendar_events.team
        and is_family_of_team(ct.id)
    )
  )
);

comment on policy "ccal_player_select" on public.club_calendar_events is 'FIX v49 (02/09/2026) : restreint par équipe quand l''événement en cible une (team non null) — avant ce correctif, tout événement du club était visible par toute famille affiliée au club, quelle que soit l''équipe. Événements sans équipe (team is null) restent club-larges, comportement voulu (addendum Fouka §19).';

-- ROLLBACK (état exact d'avant ce correctif) :
-- drop policy if exists "ccal_player_select" on public.club_calendar_events;
-- create policy "ccal_player_select" on public.club_calendar_events for select using (
--   exists (
--     select 1 from public.player_profiles pp
--     where pp.club_id = club_calendar_events.club_id
--       and pp.account_status <> 'retire'
--       and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
--   )
-- );
