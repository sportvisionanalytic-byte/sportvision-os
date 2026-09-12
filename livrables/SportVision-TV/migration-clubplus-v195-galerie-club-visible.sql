-- v195 — Une galerie de club, sans équipe, reste visible des familles (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. `media_album_list` filtrait ainsi :
--     and (p_team_id is null or a.team_id = p_team_id)
--     and (p_saison_id is null or a.saison_id = p_saison_id)
-- Connect passe TOUJOURS l'équipe et la saison du joueur. Une galerie sans équipe ne remontait
-- donc jamais — publiée, payante, correcte, et invisible, sans le moindre message.
--
-- Or une galerie sans équipe, c'est le tournoi, le plateau, le gala, la journée club : ce qu'on
-- vend le plus. `creer_galeries_mission` y bascule d'ailleurs dès que le repli `t.name = m.team`
-- échoue, une égalité stricte sensible à la casse et aux accents. Et l'OS laisse créer une
-- galerie sans saison alors que Connect en passe toujours une : même disparition silencieuse.
--
-- CE QUE FAIT CETTE MIGRATION. Une galerie non rattachée à une équipe appartient au club entier :
-- elle est servie à toutes ses familles. Idem pour la saison. L'accès réel au contenu reste
-- décidé par `can_access_media`, inchangé : cette liste ne montre qu'un titre et une couverture.
-- Idempotente.

create or replace function public.media_album_list(p_club_id uuid, p_team_id uuid default null, p_saison_id uuid default null)
returns table(id uuid, title text, event_date date, cover_preview_url text, photo_count integer,
              published_at timestamptz, unlocked boolean)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if not (is_staff() or is_club_member(p_club_id) or is_family_of_club(p_club_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  return query
  select
    a.id, a.title, a.event_date, a.cover_preview_url, a.photo_count, a.published_at,
    can_access_media(a.id)
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    -- `a.team_id is null` : galerie de club (tournoi, plateau, gala), servie à tout le club.
    and (p_team_id is null or a.team_id is null or a.team_id = p_team_id)
    and (p_saison_id is null or a.saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;
