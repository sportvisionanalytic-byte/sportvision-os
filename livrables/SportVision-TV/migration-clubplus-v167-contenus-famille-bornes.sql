-- v167 : la médiathèque du club ne part plus entière chez le parent (12/09/2026).
--
-- connect_list_contents_for_athletes() est SECURITY DEFINER : elle s'exécute donc en dehors de la
-- RLS de club_media. Elle rendait TOUS les médias non expirés du club de l'enfant, sans jamais
-- appeler is_media_visible_to_family() — la règle qui existe précisément pour ça et que Club+
-- applique partout ailleurs. Un parent lisait donc aussi les médias réservés à une autre équipe,
-- ceux signalés ou masqués, et ceux qui montrent un joueur sans droit à l'image valide.
--
-- La fonction applique maintenant cette règle, et s'ouvre au passage au cas « enfant affilié à un
-- club » (parent_player_relationships confirmé), qui n'avait aucune branche : le parent voyait la
-- médiathèque d'un sportif « lié » mais rien pour son propre enfant.
-- Test : tests/contenus-famille-bornes.test.sql

drop function if exists public.connect_list_contents_for_athletes();
create function public.connect_list_contents_for_athletes()
returns table (athlete_kind text, athlete_ref_id uuid, athlete_label text, id uuid, title text,
               type text, team text, link text, created_at timestamp with time zone)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select 'linked'::text, pp.user_id, coalesce(nullif(trim(pp.prenom), ''), 'Sportif'),
    cm.id, cm.title, cm.type, cm.team, cm.link, cm.created_at
  from connect_access_relationships car
  join player_profiles pp on pp.user_id = car.owner_user_id
  join club_media cm on cm.club_id = pp.club_id and cm.expired = false
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_voir
    and pp.account_status <> 'retire'
    and is_media_visible_to_family('club_media', cm.id)

  union all
  select 'club'::text, p.id, coalesce(nullif(trim(p.prenom), ''), 'Votre enfant'),
    cm.id, cm.title, cm.type, cm.team, cm.link, cm.created_at
  from parent_player_relationships ppr
  join parent_profiles pf on pf.id = ppr.parent_id and pf.user_id = auth.uid()
  join player_profiles p on p.id = ppr.player_id
  join club_media cm on cm.club_id = p.club_id and cm.expired = false
  where ppr.statut = 'confirme' and p.account_status <> 'retire'
    and is_media_visible_to_family('club_media', cm.id);
end;
$function$;
revoke execute on function public.connect_list_contents_for_athletes() from public, anon;
grant execute on function public.connect_list_contents_for_athletes() to authenticated;
