-- v168 : la notification « nouvelle galerie » mène enfin quelque part (12/09/2026).
--
-- Deux défauts dans le trigger posé par v156, trouvés le même jour par deux audits différents :
--
-- 1. LE PARENT ATTERRISSAIT DANS LE VIDE. Le lien envoyé était « /photos », qui est la page de
--    l'Espace joueur : un compte parent y est redirigé vers son propre espace et ne voit jamais les
--    photos annoncées. Le parent est désormais envoyé sur la page des photos de SON enfant.
-- 2. DEUX GALERIES DE MÊME TITRE N'EN FAISAIENT QU'UNE. L'index d'unicité portait sur le titre :
--    « Nouvelle galerie · Photos du match » envoyée une fois, la suivante était silencieusement
--    ignorée pour toujours. L'unicité porte maintenant sur la galerie elle-même, dont
--    l'identifiant est dans le lien.
-- Test : tests/galerie-publication-notification.test.sql
--
-- La galerie reste notifiée UNE FOIS par personne : repasser en brouillon puis republier ne
-- prévient pas une seconde fois.

drop index if exists member_notifications_galerie_uniq;
create unique index if not exists member_notifications_galerie_uniq
  on public.member_notifications (user_id, target_href)
  where category = 'content' and target_href like '%galerie=%';

create or replace function public.notifier_publication_galerie()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_equipe text;
  v_titre text;
  v_corps text;
begin
  if new.status <> 'published' or coalesce(old.status, '') = 'published' or new.team_id is null then
    return new;
  end if;
  select name into v_equipe from club_teams where id = new.team_id;
  v_titre := 'Nouvelle galerie · ' || coalesce(new.title, 'photos');
  v_corps := coalesce(v_equipe, 'Votre équipe') || ' : les photos sont en ligne.';

  -- Le coach de l'équipe (et responsable d'équipe, et directeur sportif), dans Club+.
  insert into member_notifications (user_id, category, title, body, target_href)
  select cm.user_id, 'content', v_titre, v_corps, '/galeries?galerie=' || new.id::text
    from club_members cm
   where cm.club_id = new.club_id and cm.status = 'actif'
     and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')
     and cm.teams @> to_jsonb(v_equipe)
  on conflict do nothing;

  -- Le joueur affilié, dans son espace.
  insert into member_notifications (user_id, category, title, body, target_href)
  select p.user_id, 'content', v_titre, v_corps, '/photos?galerie=' || new.id::text
    from team_memberships tm
    join player_profiles p on p.id = tm.player_id
   where tm.team_id = new.team_id and tm.statut = 'active' and p.user_id is not null
  on conflict do nothing;

  -- Le parent confirmé, sur la page des photos de SON enfant : « /photos » est une page de
  -- l'Espace joueur, elle le renvoyait chez lui sans jamais lui montrer les photos.
  insert into member_notifications (user_id, category, title, body, target_href)
  select pp.user_id, 'content', v_titre, v_corps,
         '/particulier/sportifs/club/' || p.id::text || '/photos?galerie=' || new.id::text
    from team_memberships tm
    join player_profiles p on p.id = tm.player_id
    join parent_player_relationships ppr on ppr.player_id = p.id and ppr.statut = 'confirme'
    join parent_profiles pp on pp.id = ppr.parent_id
   where tm.team_id = new.team_id and tm.statut = 'active' and pp.user_id is not null
  on conflict do nothing;

  return new;
end $$;
