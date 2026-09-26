-- v283 — 26/09/2026 : l'OS doit voir quelles photos n'ont PAS d'aperçu net
--
-- Sans cette colonne, l'écran de galerie ne peut pas distinguer une photo prête d'une photo prête
-- MAIS dont l'aperçu net n'a jamais été fabriqué. Ce sont pourtant les 2 856 photos déposées avant
-- la v282 : une famille qui paie le Pass y verrait encore le filigrane, et personne ne saurait
-- pourquoi.
--
-- `preview_watermarked` ne pouvait pas répondre : elle dit ce qui a été appliqué à l'aperçu PUBLIC,
-- pas si le net existe.
--
-- Idempotent.
create or replace function public.media_album_assets(
  p_album_id uuid, p_limit integer default 100, p_offset integer default 0,
  p_include_hidden boolean default true
) returns table (
  id uuid, original_filename text, mime_type text, original_path text, preview_path text,
  thumb_path text, preview_clair_path text, width integer, height integer, bytes bigint,
  "position" integer, status text, processing_error text,
  created_at timestamp with time zone, is_cover boolean, preview_watermarked boolean, total bigint
)
language sql stable security definer
set search_path to 'public'
as $function$
  select a.id, a.original_filename, a.mime_type, a.original_path, a.preview_path, a.thumb_path,
         a.preview_clair_path,
         a.width, a.height, a.bytes, a.position, a.status, a.processing_error, a.created_at,
         (al.cover_asset_id = a.id) as is_cover,
         a.preview_watermarked,
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
$function$;
