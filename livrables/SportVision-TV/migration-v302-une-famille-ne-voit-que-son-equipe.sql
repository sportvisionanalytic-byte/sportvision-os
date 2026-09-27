-- v302 — 27/09/2026 : une famille ne voit que les galeries de l'équipe de son enfant
--
-- FOUKA, EN OUVRANT L'APPLICATION : « tout le monde voit les galeries de tout le monde. Alors que
-- normalement, les joueurs doivent voir uniquement leur propre galerie à eux. »
--
-- C'EST MOI QUI L'AI PROVOQUÉ, la veille. `media_album_list` portait depuis la v280 une branche
-- « galerie de club » : team_id vide ET team_ids vide, visible par tout le monde. Elle ne concernait
-- presque aucune galerie, donc elle ne se voyait pas. En rattachant 23 galeries à leur club sans
-- équipe (v296), j'ai fait tomber les 23 dans cette branche d'un coup — et des photos d'enfants se
-- sont affichées à des familles qui n'y ont rien à voir.
--
-- La leçon est moins sur la ligne que sur ma démarche : j'avais posé la question de l'équipe à Fouka
-- et retenu sa réponse (« au club, sans équipe »), sans mesurer ce que « sans équipe » déclenchait
-- ailleurs dans le code. Une valeur qui n'existait quasiment jamais en base devenait la valeur
-- majoritaire.
--
-- LA RÈGLE MAINTENANT : le staff SportVision et les membres du club voient toutes les galeries, y
-- compris celles sans équipe — c'est leur travail, et le club consulte ses photos dans Club+. Une
-- famille ne voit que les galeries rattachées à l'équipe de son enfant, principale ou supplémentaire.
--
-- Une galerie sans équipe n'est pas perdue : elle reste vendable par son lien public, et visible du
-- club. Elle n'apparaît simplement plus dans l'espace d'une famille.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.media_album_list(p_club_id uuid, p_team_id uuid DEFAULT NULL::uuid, p_saison_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, title text, event_date date, cover_preview_url text, cover_path text, photo_count integer, published_at timestamp with time zone, unlocked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tout_le_club boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if not (is_staff() or is_club_member(p_club_id) or is_family_of_club(p_club_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  -- v302, 27/09/2026 — QUI A LE DROIT DE VOIR TOUT LE CLUB, ET QUI N'A QUE SON ÉQUIPE.
  -- Le staff SportVision et les membres du club voient l'ensemble des galeries : c'est leur travail.
  -- Une famille ne voit que celles de l'équipe de son enfant.
  v_tout_le_club := is_staff() or is_club_member(p_club_id);

  return query
  select
    a.id, a.title, a.event_date, a.cover_preview_url,
    -- La photo désignée, sinon la première de la galerie. Jamais la vignette : la carte est large,
    -- une vignette de 480 px y serait floue.
    coalesce(
      (select s.preview_path from media_assets s
        where s.id = a.cover_asset_id and s.album_id = a.id and s.status = 'ready'),
      (select s.preview_path from media_assets s
        where s.album_id = a.id and s.status = 'ready' and s.preview_path is not null
        order by s.position, s.created_at, s.id limit 1)
    ) as cover_path,
    a.photo_count, a.published_at,
    can_access_media(a.id)
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    and (
      (v_tout_le_club and p_team_id is null)
      -- GALERIE DE CLUB — les DEUX champs vides (v280) — POUR LE CLUB ET LE STAFF SEULEMENT.
      --
      -- Fouka, 27/09/2026 : « tout le monde voit les galeries de tout le monde. Alors que les
      -- joueurs doivent voir uniquement leur propre galerie à eux. » C'est cette ligne qui le
      -- causait, et c'est moi qui l'ai rendue visible la veille en rattachant 23 galeries à leur
      -- club sans équipe (v296) : chacune devenait « galerie de club », donc visible par TOUTES les
      -- familles du club. Des photos d'enfants s'affichaient à des familles qui n'y ont rien à voir.
      --
      -- Une galerie sans équipe reste vendable par son lien et visible du club ; elle n'apparaît
      -- plus dans l'espace d'une famille. Les sept qui n'ont pas pu être rattachées (v301) attendent
      -- qu'on leur donne une équipe depuis l'OS.
      or (v_tout_le_club and a.team_id is null and cardinality(a.team_ids) = 0)
      or a.team_id = p_team_id
      or p_team_id = any(a.team_ids)
    )
    and (p_saison_id is null or a.saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$
;
