-- v166 : le parent voit enfin le calendrier de l'enfant affilié à un club (12/09/2026).
--
-- connect_list_calendar_for_athletes() ne connaissait que deux cas : le sportif « lié » (compte
-- Connect qui partage ses accès) et le sportif « géré » (fiche créée par le parent). Le cas le plus
-- courant, l'enfant affilié à un club partenaire (parent_player_relationships, statut confirmé),
-- n'avait aucune branche : la fiche de l'enfant annonçait un « Prochain événement » et le
-- calendrier du parent restait vide.
--
-- Deux sources s'ajoutent, exactement celles que voit le joueur lui-même :
--   • les rendez-vous du club (club_calendar_events), bornés à l'équipe de l'enfant, plus ceux qui
--     ne visent aucune équipe (ils concernent tout le club) ;
--   • les matchs de son équipe (club_matches), avec leur état sportif, pour qu'un match reporté ou
--     annulé se voie au lieu de rester « à venir ».
-- Aucun élargissement d'accès : la fonction ne rend que ce qu'un parent CONFIRMÉ peut déjà lire.
-- Test : tests/calendrier-parent-enfant-club.test.sql

drop function if exists public.connect_list_calendar_for_athletes();
create function public.connect_list_calendar_for_athletes()
returns table (athlete_kind text, athlete_ref_id uuid, athlete_label text, id uuid, event_date date,
               type text, title text, team text, event_time time without time zone, location text, source text)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select 'linked'::text, pp.user_id, coalesce(nullif(trim(pp.prenom), ''), 'Sportif'),
    cc.id, cc.event_date, cc.type, cc.title, cc.team, cc.event_time, cc.location, 'club'::text
  from connect_access_relationships car
  join player_profiles pp on pp.user_id = car.owner_user_id
  join club_calendar_events cc on cc.club_id = pp.club_id
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_calendrier
    and pp.account_status <> 'retire'

  union all
  select 'linked'::text, car.owner_user_id, coalesce(nullif(trim(pp2.prenom), ''), car.grantee_display_name, 'Sportif'),
    mce.id, mce.event_date, 'match'::text,
    case when mce.adversaire is not null then 'Match vs ' || mce.adversaire else 'Match' end,
    null::text, mce.event_time, mce.lieu, 'manual'::text
  from connect_manual_calendar_events mce
  join connect_access_relationships car on car.owner_user_id = mce.athlete_ref_id and car.grantee_user_id = auth.uid()
  left join player_profiles pp2 on pp2.user_id = mce.athlete_ref_id
  where mce.athlete_kind = 'linked' and car.status = 'acceptee' and car.right_calendrier

  union all
  select 'managed'::text, mce.athlete_ref_id, coalesce(nullif(trim(map.prenom || ' ' || map.nom), ''), 'Sportif'),
    mce.id, mce.event_date, 'match'::text,
    case when mce.adversaire is not null then 'Match vs ' || mce.adversaire else 'Match' end,
    null::text, mce.event_time, mce.lieu, 'manual'::text
  from connect_manual_calendar_events mce
  join managed_athlete_profiles map on map.id = mce.athlete_ref_id and map.owner_user_id = auth.uid()
  where mce.athlete_kind = 'managed'

  -- ── Nouveau (12/09/2026) : l'enfant affilié à un club ──
  union all
  select 'club'::text, p.id, coalesce(nullif(trim(p.prenom), ''), 'Votre enfant'),
    cc.id, cc.event_date, cc.type, cc.title, cc.team, cc.event_time, cc.location, 'club'::text
  from parent_player_relationships ppr
  join parent_profiles pf on pf.id = ppr.parent_id and pf.user_id = auth.uid()
  join player_profiles p on p.id = ppr.player_id
  join club_calendar_events cc on cc.club_id = p.club_id
  where ppr.statut = 'confirme' and p.account_status <> 'retire'
    and (cc.team_id is null
         or exists (select 1 from team_memberships tm
                     where tm.player_id = p.id and tm.statut = 'active' and tm.team_id = cc.team_id))

  union all
  select 'club'::text, p.id, coalesce(nullif(trim(p.prenom), ''), 'Votre enfant'),
    m.id, m.match_date,
    case coalesce(m.sport_status, 'scheduled')
      when 'postponed' then 'match_reporte' when 'cancelled' then 'match_annule' else 'match' end,
    case when m.is_home is false then 'Déplacement à ' || coalesce(m.opponent, 'adversaire à confirmer')
         else 'Match contre ' || coalesce(m.opponent, 'adversaire à confirmer') end
    || case coalesce(m.sport_status, 'scheduled')
         when 'postponed' then ' (reporté)' when 'cancelled' then ' (annulé)' else '' end,
    m.team, m.kickoff_time, m.lieu, 'club'::text
  from parent_player_relationships ppr
  join parent_profiles pf on pf.id = ppr.parent_id and pf.user_id = auth.uid()
  join player_profiles p on p.id = ppr.player_id
  join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
  join club_matches m on m.team_id = tm.team_id and m.match_date is not null
  where ppr.statut = 'confirme' and p.account_status <> 'retire';
end;
$function$;
revoke execute on function public.connect_list_calendar_for_athletes() from public, anon;
grant execute on function public.connect_list_calendar_for_athletes() to authenticated;
