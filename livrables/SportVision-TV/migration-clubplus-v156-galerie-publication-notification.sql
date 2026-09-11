-- v156 : publier une galerie prévient l'équipe concernée (11/09/2026).
--
-- Décision de Fouka : la galerie d'une équipe doit « arriver » chez les intéressés, et seulement
-- chez eux ; dans l'application, jamais par e-mail (la limite d'envoi est déjà serrée, et une
-- galerie par équipe ferait des dizaines d'e-mails).
--
-- Qui est prévenu quand la Production publie :
--   • le coach de l'équipe dans Club+ (club_members.teams, la même règle que partout), vers
--     /galeries ;
--   • dans Connect, le joueur affilié à l'équipe (team_memberships actif) et son parent confirmé,
--     vers /photos.
-- Une galerie sans équipe (galerie du club, prestation ponctuelle) ne déclenche rien : elle ne
-- concerne personne en particulier.
-- Repasser en brouillon puis republier ne prévient pas une seconde fois : la notification est
-- posée une fois par personne et par galerie.
-- Test : tests/galerie-publication-notification.test.sql

create unique index if not exists member_notifications_galerie_uniq
  on public.member_notifications (user_id, target_href, title)
  where category = 'content' and target_href in ('/galeries', '/photos');

create or replace function public.notifier_publication_galerie()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_equipe text;
  v_titre text;
begin
  if new.status <> 'published' or coalesce(old.status, '') = 'published' or new.team_id is null then
    return new;
  end if;
  select name into v_equipe from club_teams where id = new.team_id;
  v_titre := 'Nouvelle galerie · ' || coalesce(new.title, 'photos');

  -- Le coach de l'équipe (et responsable d'équipe, et directeur sportif), dans Club+.
  insert into member_notifications (user_id, category, title, body, target_href)
  select cm.user_id, 'content', v_titre,
         coalesce(v_equipe, 'Votre équipe') || ' : les photos sont en ligne.', '/galeries'
    from club_members cm
   where cm.club_id = new.club_id and cm.status = 'actif'
     and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')
     and cm.teams @> to_jsonb(v_equipe)
  on conflict do nothing;

  -- Les familles de l'équipe, dans Connect : le joueur affilié et son parent confirmé.
  insert into member_notifications (user_id, category, title, body, target_href)
  select u, 'content', v_titre, coalesce(v_equipe, 'Votre équipe') || ' : les photos sont en ligne.', '/photos'
    from (
      select p.user_id as u
        from team_memberships tm join player_profiles p on p.id = tm.player_id
       where tm.team_id = new.team_id and tm.statut = 'active' and p.user_id is not null
      union
      select pp.user_id
        from team_memberships tm
        join parent_player_relationships ppr on ppr.player_id = tm.player_id and ppr.statut = 'confirme'
        join parent_profiles pp on pp.id = ppr.parent_id
       where tm.team_id = new.team_id and tm.statut = 'active' and pp.user_id is not null
    ) f
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists trg_notifier_publication_galerie on public.media_albums;
create trigger trg_notifier_publication_galerie
  after update of status on public.media_albums
  for each row execute function public.notifier_publication_galerie();
