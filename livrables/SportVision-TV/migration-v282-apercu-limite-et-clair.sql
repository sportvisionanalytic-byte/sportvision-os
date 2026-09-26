-- v282 — 26/09/2026 : l'aperçu du non-payeur, et la fin de la case à cocher
--
-- Demandes de Fouka, deux d'un coup, et elles ont la MÊME cause :
--
--   « à chaque fois que je mets des photos je dois décocher recocher pour pouvoir mettre en ligne ;
--     j'aimerais que quand les photos finissent de télécharger je puisse directement cliquer sur
--     mettre en ligne »
--   « ceux qui n'ont pas payé le pass peuvent voir leurs photos, mais avec filigrane, un aperçu
--     uniquement de 3-4 photos »
--
-- POURQUOI C'EST LA MÊME CAUSE
--
-- Il n'y avait qu'UN aperçu par photo. Le filigrane étant cuit dedans, il fallait choisir à
-- l'avance : marqué (et tout le monde le voit, y compris ceux qui ont payé) ou clair (et il part en
-- 1600 px, gratuitement, à quiconque devine l'adresse). D'où un garde-fou à la mise en ligne qui
-- refusait de publier une galerie payante aux aperçus clairs, et la danse décocher/recocher/
-- régénérer que Fouka subissait à chaque dépôt.
--
-- Avec deux fichiers — le marqué public, le clair privé et gardé (v281) — le choix disparaît. Le
-- public est TOUJOURS marqué, il n'y a donc plus rien à vérifier avant de publier, et plus aucune
-- case à cocher. Le garde-fou et la case sont retirés de l'OS dans le même commit que cette
-- migration : ils ne protégeaient d'un danger qui n'existe plus.
--
-- LE PLAFOND DU NON-PAYEUR
--
-- 4 photos. C'est assez pour reconnaître son enfant et se décider, trop peu pour se passer du
-- Pass. La limite est appliquée EN BASE et non dans l'application : une limite côté écran se
-- contourne en rejouant la même requête, et ces photos se vendent.
--
-- `total` est rendu quand même, sur toutes les lignes : sans lui l'écran ne saurait plus dire
-- « 37 autres photos de vous » et afficherait « 0 autre », ce qui donnerait à croire qu'il n'y en a
-- pas plus — exactement l'inverse de l'effet voulu.
--
-- Idempotent.

-- ── Ce que la famille voit d'un joueur ───────────────────────────────────────────────────────
drop function if exists public.media_photos_du_joueur(uuid, uuid);

create or replace function public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
returns table (
  asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
  ordre integer, marque_par text, total integer
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    select 1
     where auth.uid() is not null
       and (
         is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), lignes as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position, t.source
      from media_assets a
      join media_albums al on al.id = a.album_id
      join media_player_tags t
        on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
       and t.player_id = p_player_id and t.statut = 'valide'
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
     order by a.position, a.id
  ), compte as (
    select count(*)::integer as n from lignes
  )
  select l.id, l.preview_path, l.thumb_path,
         -- Le chemin clair ne sort QUE pour qui y a droit. La politique de stockage refuserait de
         -- toute façon le fichier, mais rendre un chemin qu'on sait inutilisable ferait afficher
         -- des images cassées au lieu d'aperçus marqués.
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.source,
         (select n from compte)
    from lignes l
   limit case when (select clair from droit) then null else 4 end;
$function$;

revoke all on function public.media_photos_du_joueur(uuid, uuid) from public;
grant execute on function public.media_photos_du_joueur(uuid, uuid) to authenticated;

-- ── Ses photos plus celles de groupe (écrans web) ────────────────────────────────────────────
drop function if exists public.media_photos_pour_famille(uuid, uuid);

create or replace function public.media_photos_pour_famille(p_album_id uuid, p_player_id uuid)
returns table (
  asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
  ordre integer, de_groupe boolean, marque boolean, total integer
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    select 1
     where auth.uid() is not null
       and (
         is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)
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
$function$;

revoke all on function public.media_photos_pour_famille(uuid, uuid) from public;
grant execute on function public.media_photos_pour_famille(uuid, uuid) to authenticated;
