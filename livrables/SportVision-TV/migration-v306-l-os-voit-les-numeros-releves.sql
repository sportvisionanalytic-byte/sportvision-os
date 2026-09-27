-- v306 — 27/09/2026 : l'OS doit voir les numéros déjà relevés
--
-- La v305 a ajouté `media_assets.numeros_visibles`, mais `media_album_assets` ne la rendait pas : la
-- modale « Qui est sur cette photo ? » aurait affiché un champ VIDE à chaque ouverture, et on aurait
-- réécrit à chaque fois ce qui était déjà saisi — en croyant compléter, on aurait effacé.
--
-- La signature gagne une colonne, donc il faut supprimer puis recréer. Les droits d'exécution sont
-- reposés explicitement : la suppression les emporte, et l'OS recevrait un refus.
--
-- Idempotent.

drop function if exists public.media_album_assets(uuid, integer, integer, boolean);

CREATE FUNCTION public.media_album_assets(p_album_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_include_hidden boolean DEFAULT true)
 RETURNS TABLE(id uuid, original_filename text, mime_type text, original_path text, preview_path text, thumb_path text, preview_clair_path text, width integer, height integer, bytes bigint, "position" integer, status text, processing_error text, created_at timestamp with time zone, is_cover boolean, preview_watermarked boolean, numeros_visibles smallint[], total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.original_filename, a.mime_type, a.original_path, a.preview_path, a.thumb_path,
         a.preview_clair_path,
         a.width, a.height, a.bytes, a.position, a.status, a.processing_error, a.created_at,
         (al.cover_asset_id = a.id) as is_cover,
         a.preview_watermarked,
         -- v306 : les numeros deja releves sur la photo. Sans eux, la modale de l'OS afficherait un
         -- champ vide a chaque ouverture et on reecrirait ce qui etait deja saisi.
         a.numeros_visibles,
         count(*) over () as total
  from media_assets a
  join media_albums al on al.id = a.album_id
  where a.album_id = p_album_id
    and media_upload_staff()
    -- Sans cette ligne la policy serait cosmetique : cette fonction est SECURITY DEFINER
    -- et contourne donc la RLS de media_albums.
    and (not est_operateur_terrain() or photographe_voit_album(p_album_id))
    and a.status <> 'removed'
    and (p_include_hidden or a.status = 'ready')
  order by a.position, a.created_at, a.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$function$
;

grant execute on function public.media_album_assets(uuid, integer, integer, boolean) to anon, authenticated, service_role;
