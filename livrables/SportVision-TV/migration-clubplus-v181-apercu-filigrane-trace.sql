-- v181 : savoir si un aperçu porte le filigrane, photo par photo (12/09/2026).
--
-- Avant la première vente de galeries de tournoi. Le filigrane est appliqué au moment où l'aperçu
-- est fabriqué, dans le navigateur, au dépôt de la photo. L'activer après coup ne change donc rien
-- aux photos déjà déposées : leurs aperçus restent en clair, en 1600 px, et ce sont eux que la
-- galerie publique montre avant achat. Le réglage est honnête (« filigrane activé pour les
-- prochains dépôts »), mais rien ne permettait de savoir, au moment de mettre en ligne, qu'une
-- partie des aperçus était restée sans protection : une galerie payante pouvait partir avec des
-- centaines d'images propres, téléchargeables d'un clic droit.
--
-- Cette colonne garde la trace, photo par photo. L'écran s'en sert pour prévenir avant la mise en
-- ligne et proposer la régénération, au lieu de laisser deviner.
-- Les photos déjà déposées restent à `null` : on ne sait pas, et on ne fait pas semblant de savoir.
-- Test : tests/apercu-filigrane-trace.test.sql

alter table public.media_assets add column if not exists preview_watermarked boolean;

comment on column public.media_assets.preview_watermarked is
  'Vrai si les dérivés (vignette et aperçu) ont été fabriqués avec le filigrane, faux sinon, null pour les photos déposées avant le 12/09/2026, où l''information n''était pas conservée.';

-- La liste des photos d'une galerie rend aussi l'état du filigrane, sans quoi l'écran ne peut pas
-- prévenir avant la mise en ligne. La colonne s'insère avant `total`, qui reste en dernier.
drop function if exists public.media_album_assets(uuid, integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.media_album_assets(p_album_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_include_hidden boolean DEFAULT true)
 RETURNS TABLE(id uuid, original_filename text, mime_type text, original_path text, preview_path text, thumb_path text, width integer, height integer, bytes bigint, "position" integer, status text, processing_error text, created_at timestamp with time zone, is_cover boolean, preview_watermarked boolean, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.original_filename, a.mime_type, a.original_path, a.preview_path, a.thumb_path,
         a.width, a.height, a.bytes, a.position, a.status, a.processing_error, a.created_at,
         (al.cover_asset_id = a.id) as is_cover,
         a.preview_watermarked,
         count(*) over () as total
  from media_assets a
  join media_albums al on al.id = a.album_id
  where a.album_id = p_album_id
    and media_upload_staff()
    -- Ajout 09/09/2026 : un operateur terrain reste borne a son perimetre, ici aussi.
    -- Sans cette ligne la policy serait cosmetique : cette fonction est SECURITY DEFINER
    -- et contourne donc la RLS de media_albums.
    and (not est_operateur_terrain() or photographe_voit_album(p_album_id))
    and a.status <> 'removed'
    and (p_include_hidden or a.status = 'ready')
  order by a.position, a.created_at, a.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$function$;
