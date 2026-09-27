-- v304 — 27/09/2026 : quatre photos d'une galerie U10 servies à une famille de U18
--
-- MESURÉ, PAS SUPPOSÉ. En fermant la liste des galeries (v302), j'ai voulu vérifier que le CONTENU
-- était fermé lui aussi. Il ne l'était pas :
--
--     galerie visée : « Villemomble Cup U10 - epinay »
--     famille de Lucas, U18 R3
--     media_photos_du_joueur      -> 4 photo(s)     ← des enfants d'une autre équipe
--     media_galerie_a_identifier  -> 0 photo(s)
--
-- C'est l'aperçu de repli de la v299, que j'ai ajouté la veille : il rend quatre photos de la
-- galerie à qui n'a pas le Pass, et il ne regardait AUCUNE équipe. Il suffisait de passer
-- l'identifiant d'une galerie. Une liste filtrée n'est pas un contrôle d'accès — c'est la leçon du
-- 10/09 (« auditer la lecture, pas que l'écriture »), et je viens de la repayer.
--
-- `media_galerie_a_identifier` rendait 0 ici, mais sa vérification laissait passer deux cas : une
-- galerie SANS équipe (que plus aucune famille ne doit voir depuis la v302) et les catégories
-- SUPPLÉMENTAIRES de `team_ids` (v280), qu'elle ignorait — un enfant inscrit dans une catégorie
-- supplémentaire se voyait refuser une galerie qui est bien la sienne.
--
-- La règle vit dans `media_galerie_concerne_le_joueur(album, joueur)`, appelée par les trois
-- fonctions du parcours famille. Troisième règle extraite en deux jours, après le droit payé (v298)
-- et le cloisonnement du club (v303) : c'est le même défaut de fond, une règle métier recopiée.
--
-- Idempotent.

create or replace function public.media_galerie_concerne_le_joueur(p_album_id uuid, p_player_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public','pg_temp' as $f$
declare
  v_album record;
  v_equipes uuid[];
begin
  select * into v_album from media_albums where id = p_album_id;
  if not found then return false; end if;

  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- UNE GALERIE SANS AUCUNE EQUIPE NE CONCERNE AUCUNE FAMILLE. Elle se vend par son lien et se
  -- consulte dans Club+, ou le club est authentifie. C'est la regle posee par la v302, et elle vaut
  -- ici aussi : sinon la liste est bornee a l'equipe de l'enfant, mais le CONTENU reste accessible a
  -- qui connait un identifiant de galerie.
  if cardinality(v_equipes) = 0 then return false; end if;

  return exists (
    select 1 from team_memberships tm
     where tm.player_id = p_player_id and tm.statut = 'active'
       and tm.team_id = any(v_equipes));
end $f$;

comment on function public.media_galerie_concerne_le_joueur(uuid, uuid) is
  'v304 : cette galerie est-elle celle d''une equipe de ce sportif ? Une galerie sans equipe ne concerne aucune famille. Regle unique, appelee par media_photos_du_joueur, media_photos_pour_famille et media_galerie_a_identifier.';

CREATE OR REPLACE FUNCTION public.media_galerie_a_identifier(p_album_id uuid, p_player_id uuid)
 RETURNS TABLE(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text, ordre integer, de_groupe boolean, mienne boolean, marquee_par_une_autre boolean, suggeree boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_net boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;

  -- La famille de CE joueur, et seulement elle.
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Ce joueur n''est pas rattaché à votre compte.' using errcode = '42501';
  end if;

  -- L'enfant doit jouer dans une equipe de la galerie : on ne montre pas les photos d'une equipe ou
  -- il n'est pas. v304 : la regle vit dans media_galerie_concerne_le_joueur(), et elle traite deux
  -- cas que la version precedente laissait passer — une galerie SANS equipe (que plus aucune famille
  -- ne doit voir, v302) et les categories SUPPLEMENTAIRES de team_ids (v280), qu'elle ignorait.
  if not public.media_galerie_concerne_le_joueur(p_album_id, p_player_id) then
    return;
  end if;

  -- LE VERROU AJOUTÉ (v287). Sans lui, cette fonction servait les 110 photos d'une galerie à qui
  -- n'avait rien payé, et contournait le plafond de quatre de la v282.
  v_net := media_voit_sans_filigrane(p_album_id);
  if not v_net then
    return;
  end if;

  return query
  select a.id, a.preview_path, a.thumb_path, a.preview_clair_path,
         a.position, a.photo_de_groupe,
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id = p_player_id and t.statut = 'valide'),
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id <> p_player_id and t.statut = 'valide'),
         -- Ce que la machine propose et que personne n'a encore tranché : le point de départ de
         -- l'écran.
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id = p_player_id and t.statut = 'propose')
    from media_assets a
    join media_albums al on al.id = a.album_id
   where a.album_id = p_album_id
     and a.status = 'ready'
     and al.status = 'published'
   order by
     -- Les suggestions d'abord : c'est ce qu'on demande de trancher.
     (exists (select 1 from media_player_tags t
               where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                 and t.player_id = p_player_id and t.statut = 'propose')) desc,
     a.position, a.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
 RETURNS TABLE(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text, ordre integer, marque_par text, total integer, apercu_galerie boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    -- v304 — LA FAMILLE DOIT AUSSI ETRE CONCERNEE PAR CETTE GALERIE, et pas seulement etre celle de
    -- l'enfant. Mesure du 27/09, avant correction : une famille de U18 R3 obtenait QUATRE PHOTOS
    -- d'une galerie U10 en passant simplement son identifiant. C'est l'apercu de repli de la v299 —
    -- que j'ai ajoute la veille — qui rendait ces photos, parce qu'il ne regardait aucune equipe.
    -- La liste des galeries est bornee (v302), mais une liste bornee n'est pas un controle d'acces.
    select 1
     where auth.uid() is not null
       and (
         ((is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
          and public.media_galerie_concerne_le_joueur(p_album_id, p_player_id))
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), siennes as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position, t.source,
           a.photo_de_groupe
      from media_assets a
      join media_albums al on al.id = a.album_id
      join media_player_tags t
        on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
       and t.player_id = p_player_id and t.statut = 'valide'
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
  ), toute_la_galerie as (
    -- Le repli. Il ne sert QUE si la famille n'a aucune photo marquee ET n'a pas encore paye :
    -- celle qui a paye veut ses photos, pas une vitrine.
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position, null::text as source,
           a.photo_de_groupe
      from media_assets a
      join media_albums al on al.id = a.album_id
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
       and not (select clair from droit)
       and not exists (select 1 from siennes)
  ), lignes as (
    select *, false as repli from siennes
    union all
    select *, true  as repli from toute_la_galerie
  ), compte as (
    select count(*)::integer as n from lignes
  )
  select l.id, l.preview_path, l.thumb_path,
         -- Le chemin clair ne sort QUE pour qui y a droit. La politique de stockage refuserait de
         -- toute facon le fichier, mais rendre un chemin qu'on sait inutilisable ferait afficher des
         -- images cassees au lieu d'apercus marques.
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.source,
         (select n from compte),
         l.repli
    from lignes l
   order by l.repli, l.photo_de_groupe desc, l.position, l.id
   limit case when (select clair from droit) then null else 4 end;
$function$
;

CREATE OR REPLACE FUNCTION public.media_photos_pour_famille(p_album_id uuid, p_player_id uuid)
 RETURNS TABLE(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text, ordre integer, de_groupe boolean, marque boolean, total integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    -- v304 — LA FAMILLE DOIT AUSSI ETRE CONCERNEE PAR CETTE GALERIE, et pas seulement etre celle de
    -- l'enfant. Mesure du 27/09, avant correction : une famille de U18 R3 obtenait QUATRE PHOTOS
    -- d'une galerie U10 en passant simplement son identifiant. C'est l'apercu de repli de la v299 qui
    -- rendait ces photos dans media_photos_du_joueur. Cette fonction-ci ne rend que des photos
    -- marquees, donc elle ne fuyait pas ; la borne y est posee pour que les deux disent la meme chose.
    -- La liste des galeries est bornee (v302), mais une liste bornee n'est pas un controle d'acces.
    select 1
     where auth.uid() is not null
       and (
         ((is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
          and public.media_galerie_concerne_le_joueur(p_album_id, p_player_id))
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), lignes as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           a.photo_de_groupe,
           exists (
             select 1 from media_player_tags t
              where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                and t.player_id = p_player_id and t.statut = 'valide'
           ) as marque
      from media_assets a
      join media_albums al on al.id = a.album_id
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
       -- Ses photos, plus les photos de groupe. Une photo sans marquage et sans groupe n'est pas ici.
       and (
         a.photo_de_groupe
         or exists (
           select 1 from media_player_tags t
            where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
              and t.player_id = p_player_id and t.statut = 'valide'
         )
       )
     order by a.position, a.id
  ), compte as (
    select count(*)::integer as n from lignes
  )
  select l.id, l.preview_path, l.thumb_path,
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.photo_de_groupe, l.marque,
         (select n from compte)
    from lignes l
   limit case when (select clair from droit) then null else 4 end;
$function$
;
