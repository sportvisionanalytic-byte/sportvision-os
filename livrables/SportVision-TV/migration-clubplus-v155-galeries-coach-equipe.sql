-- v155 : dans Club+, le coach ne voit que les galeries de ses équipes (11/09/2026).
--
-- Demande de Fouka : « que les coachs voient bien leur truc de coach », sans mélange entre équipes.
-- media_club_galleries rendait à tout membre du club l'intégralité des galeries publiées : le coach
-- des U13 voyait celles des U15, des Séniors et de toutes les autres. Il voit désormais les siennes
-- (club_members.teams, la même règle que partout : is_team_educateur) et les galeries du club sans
-- équipe. Président, secrétariat, CM affecté et agence : inchangé.
-- Test : tests/galeries-coach-equipe.test.sql

create or replace function public.media_club_galleries(p_club_id uuid)
 RETURNS TABLE(album_id uuid, titre text, equipe text, event_date date, cover_url text, photos integer, publie boolean, liens jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Membre reel OU staff SportVision autorise sur ce club (cm_clubs_autorises(), le meme
  -- referentiel que le badge "Gestion SportVision" affiche cote Club+).
  if not (is_club_member(p_club_id) or p_club_id in (select cm_clubs_autorises())) then
    return;
  end if;

  return query
  select a.id, a.title, t.name, a.event_date, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         (a.status = 'published'),
         -- Uniquement les liens explicitement confies au club. Le lien « equipe adverse » et les
         -- liens internes restent chez SportVision.
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'label', l.label, 'audience', l.audience, 'slug', l.slug, 'token', l.token,
             'is_enabled', l.is_enabled
           ) order by l.created_at)
           from media_album_links l
           where l.album_id = a.id and l.visible_in_clubplus
         ), '[]'::jsonb)
  from media_albums a
  left join club_teams t on t.id = a.team_id
  where a.club_id = p_club_id and a.status = 'published'
    -- v155 : un coach (ou responsable d'équipe, ou directeur sportif) ne voit que SES équipes,
    -- plus les galeries du club qui n'appartiennent à aucune équipe. Les autres rôles du club,
    -- le CM affecté et l'agence voient tout, comme avant.
    and (a.team_id is null
         or is_team_educateur(a.team_id)
         or not exists (select 1 from club_members cm
                         where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
                           and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')))
  order by a.event_date desc nulls last, a.created_at desc;
end;
$function$;
