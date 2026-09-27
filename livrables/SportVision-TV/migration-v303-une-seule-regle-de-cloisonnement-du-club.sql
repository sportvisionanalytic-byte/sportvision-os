-- v303 — 27/09/2026 : deux portes sur la même pièce, une seule était fermée
--
-- MESURE QUI L'A RÉVÉLÉ. En vérifiant la v302, j'ai compté ce que voit le coach de démonstration de
-- Villemomble (U18 R3 + Séniors R2) :
--
--     media_club_galleries  ->  5 galeries     (la règle v155 est appliquée)
--     media_album_list      -> 23 galeries     (elle ne l'est pas)
--
-- Club+ lui montrait 5 galeries, et la même base lui en rendait 23 par l'autre chemin — avec le
-- titre, le nombre de photos et la PHOTO DE COUVERTURE de galeries d'équipes qui ne sont pas les
-- siennes. Le cloisonnement d'un coach n'était donc pas un cloisonnement, c'était un affichage.
--
-- ET LA RÈGLE ÉTAIT DÉJÀ RECOPIÉE DEUX FOIS, avec un écart entre les copies : celle de
-- `media_club_galleries` ne regarde que `team_id`, celle de `media_voit_sans_filigrane` regarde
-- `team_id` ET `team_ids` (v280). Une galerie à plusieurs catégories échappait donc au cloisonnement
-- d'un côté et pas de l'autre. Le commentaire de la v281 annonçait exactement ça : « une seconde
-- écriture de la même règle finirait par diverger ». C'est la deuxième fois en deux jours.
--
-- La règle vit maintenant dans `media_club_voit_la_galerie(album)`, appelée par les trois. Elle
-- retient la version la plus complète, celle qui tient compte des catégories supplémentaires.
--
-- Idempotent.

create or replace function public.media_club_voit_la_galerie(p_album_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public','pg_temp' as $f$
declare
  v_album record;
  v_equipes uuid[];
begin
  if auth.uid() is null then return false; end if;
  select * into v_album from media_albums where id = p_album_id;
  if not found or v_album.club_id is null then return false; end if;

  -- Membre du club, ou CM affilie a ce club.
  if not (is_club_member(v_album.club_id) or v_album.club_id in (select cm_clubs_autorises())) then
    return false;
  end if;

  -- Toutes les categories de la galerie, la principale comprise (v280). La copie qui vivait dans
  -- media_club_galleries ne regardait QUE team_id : une galerie a plusieurs categories echappait
  -- donc au cloisonnement d'un cote et pas de l'autre. C'est exactement la divergence qu'une regle
  -- recopiee finit par produire.
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- v155 : un coach, un responsable d'equipe ou un directeur sportif ne voit que SES equipes, plus
  -- les galeries rattachees a aucune categorie. Les autres roles du club voient tout.
  if cardinality(v_equipes) = 0 then return true; end if;
  if exists (select 1 from unnest(v_equipes) as e where is_team_educateur(e)) then return true; end if;
  return not exists (
    select 1 from club_members cm
     where cm.club_id = v_album.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
       and cm.role in ('coach', 'resp_equipe', 'directeur_sportif'));
end $f$;

comment on function public.media_club_voit_la_galerie(uuid) is
  'v303 : l''unique regle de cloisonnement du staff d''un club sur une galerie (v155). media_club_galleries, media_album_list et media_voit_sans_filigrane l''appellent au lieu d''en garder chacune une copie.';

CREATE OR REPLACE FUNCTION public.media_club_galleries(p_club_id uuid)
 RETURNS TABLE(album_id uuid, titre text, equipe text, event_date date, cover_url text, cover_path text, photos integer, publie boolean, liens jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (is_club_member(p_club_id) or p_club_id in (select cm_clubs_autorises())) then
    return;
  end if;

  return query
  select a.id, a.title, t.name, a.event_date, a.cover_preview_url,
         coalesce(
           (select s.preview_path from media_assets s
             where s.id = a.cover_asset_id and s.album_id = a.id and s.status = 'ready'),
           (select s.preview_path from media_assets s
             where s.album_id = a.id and s.status = 'ready' and s.preview_path is not null
             order by s.position, s.created_at, s.id limit 1)
         ),
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         (a.status = 'published'),
         -- Le `token` ne sort PAS (v285) : le club sait quels liens existent, il ne peut pas les
         -- diffuser.
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'label', l.label, 'audience', l.audience, 'slug', l.slug,
             'is_enabled', l.is_enabled
           ) order by l.created_at)
           from media_album_links l
           where l.album_id = a.id and l.visible_in_clubplus
         ), '[]'::jsonb)
  from media_albums a
  left join club_teams t on t.id = a.team_id
  where a.club_id = p_club_id and a.status = 'published'
    -- v303 : la regle de cloisonnement vit dans media_club_voit_la_galerie(), et nulle part ailleurs.
    and public.media_club_voit_la_galerie(a.id)
  order by a.event_date desc nulls last, a.created_at desc;
end;
$function$
;

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
    -- v303 : le cloisonnement du coach s'applique ICI AUSSI. Mesure du 27/09 : le coach de
    -- demonstration voyait 5 galeries dans Club+ (media_club_galleries, qui applique la regle) et
    -- 23 par cette fonction, qui ne l'appliquait pas. Deux portes sur la meme piece, une seule
    -- fermee. Le staff SportVision garde sa vue globale ; une famille n'est pas concernee, elle est
    -- deja bornee a l'equipe de son enfant juste au-dessus.
    and (is_staff() or not is_club_member(p_club_id) or public.media_club_voit_la_galerie(a.id))
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.media_voit_sans_filigrane(p_album_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_album record;
  v_equipes uuid[];
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  -- 1. Le staff SportVision. Même nuance que can_access_media : un opérateur terrain n'est staff
  -- que pour SES prestations, sinon il récupérerait n'importe quelle galerie par son identifiant.
  if is_staff() then
    return not est_operateur_terrain() or photographe_voit_album(p_album_id);
  end if;

  -- Les catégories de la galerie, principale et supplémentaires (v280).
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- 2. Le club lui-même : coach de l'équipe concernée, président, secrétaire, CM affilié. Ce sont
  -- eux qui publient et commentent ces photos — leur servir du filigrane serait absurde.
  -- Le cloisonnement du coach de la v155 est conservé : il ne voit sans filigrane que SES équipes,
  -- plus les galeries du club qui n'appartiennent à aucune catégorie.
  -- 2. Le club lui-meme : coach de l'equipe concernee, president, secretaire, CM affilie. Ce sont
  -- eux qui publient et commentent ces photos — leur servir du filigrane serait absurde.
  -- v303 : le cloisonnement du coach (v155) vit dans media_club_voit_la_galerie(), et cette fonction
  -- l'appelle au lieu d'en garder une copie. La copie qui etait ici ne regardait pas les categories
  -- supplementaires de la meme facon que celle de media_club_galleries : elles avaient deja
  -- commence a diverger.
  if public.media_club_voit_la_galerie(p_album_id) then
    return true;
  end if;

  -- 3. Le Pass REELLEMENT PAYE. `free_members` ne suffit PAS ici : en Full Communication la
  -- famille voit deja les photos, ce qu'elle achete avec le Pass c'est de les voir sans filigrane.
  -- v298 : meme regle que can_access_media, et desormais le MEME CODE.
  return public.media_droit_paye(p_album_id);
end $function$
;
