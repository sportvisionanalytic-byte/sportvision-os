-- v311 — 27/09/2026 : un aperçu non filigrané ne sort plus en pleine taille
--
-- SIGNALÉ PAR LE RESPONSABLE PRODUCTION, rapporté par Fouka : « le filigrane, il ne se met pas bien
-- sur toutes les photos des galeries ».
--
-- MESURE : 31 photos sur 5 646 ont `preview_watermarked = false`. Toutes déposées le 14/09, toutes
-- dans deux galeries — « Villemomble Cup U10 - epinay » (16) et « - livry gargan » (15).
--
-- CE QUE LE DRAPEAU SIGNIFIE, et le code de l'OS le dit lui-même : il vaut `true` SANS EXCEPTION
-- depuis la v282, et ne reste `false` que sur les photos déposées avant, « dont le public peut être
-- clair et qu'il faut régénérer ». Ce n'est donc pas une incertitude : c'est une liste.
--
-- POURQUOI C'EST URGENT ET PAS COSMÉTIQUE : ces deux galeries se vendent par lien. Qui détient le
-- lien pouvait enregistrer une photo PROPRE en pleine taille au lieu de l'acheter. Les photos sont le
-- produit.
--
-- CE QUI EST FAIT : tant que l'aperçu n'est pas régénéré, la galerie publique sert la VIGNETTE à la
-- place de l'aperçu pleine taille. La galerie continue de s'afficher, la vignette est trop petite
-- pour valoir un vol, et l'acheteur reçoit de toute façon l'original — la vente n'est pas touchée. La
-- régénération depuis l'OS rendra la pleine taille, et ce correctif s'effacera tout seul puisqu'il est
-- conditionné au drapeau.
--
-- CE QUI N'EST PAS FAIT ICI : régénérer. Le filigrane est dessiné dans le navigateur, par le code de
-- l'OS. Le reproduire côté serveur produirait un marquage DIFFÉRENT de tous les autres, et deux
-- filigranes dans la même galerie se verraient. 31 photos, c'est un clic sur « Régénérer les
-- aperçus » dans chacune des deux galeries.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.media_gallery_photos(p_slug text, p_token text, p_password text DEFAULT NULL::text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, thumb_path text, preview_path text, preview_clair_path text, width integer, height integer, total bigint, visibles integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_max integer;
  v_debut integer;
  v_page integer;
  v_net boolean;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;

  -- LA SEULE NOUVEAUTÉ : on demande qui regarde. La réponse vaut `false` pour un visiteur non
  -- connecté, donc le comportement public ne change pas d'un iota.
  v_net := media_voit_sans_filigrane(r.album_id);

  v_max := _media_gallery_preview_limit(r.link_id);
  v_debut := greatest(0, coalesce(p_offset, 0));
  v_page := greatest(1, least(coalesce(p_limit, 60), 200));

  -- Lien plafonné : on ne sert jamais au-delà, et une page qui commence après le plafond ne
  -- renvoie rien plutôt que de re-servir les premières. Le plafond reste le même pour tous : c'est
  -- une décision commerciale sur le lien, pas une protection.
  if v_max is not null then
    if v_debut >= v_max then return; end if;
    v_page := least(v_page, v_max - v_debut);
  end if;

  return query
  select m.id, m.thumb_path,
         -- v311, 27/09/2026 — UN APERÇU NON FILIGRANÉ NE SORT PAS EN PLEINE TAILLE.
         --
         -- Le responsable production de Fouka : « le filigrane ne se met pas bien sur toutes les
         -- photos des galeries ». Mesure : 31 photos sur 5 646, toutes déposées le 14/09, ont
         -- `preview_watermarked = false`. Ce drapeau vaut `true` sans exception depuis la v282 ; il
         -- ne reste `false` que sur les photos d'avant, dont l'aperçu public PEUT être propre. Or ces
         -- 31 sont dans deux galeries vendues par lien : qui détient le lien pouvait enregistrer une
         -- photo propre en pleine taille au lieu de l'acheter.
         --
         -- Tant que l'aperçu n'a pas été régénéré, on sert la VIGNETTE à sa place. Elle est trop
         -- petite pour valoir un vol, la galerie continue de s'afficher — « mieux vaut une photo
         -- barrée qu'une case vide » — et l'acheteur reçoit de toute façon l'ORIGINAL, donc la vente
         -- n'est pas touchée. La régénération depuis l'OS rendra la pleine taille.
         case
           when m.preview_watermarked is not true and not v_net then m.thumb_path
           else m.preview_path
         end,
         -- Le chemin net ne sort que pour qui y a droit. La politique de stockage refuserait le
         -- fichier de toute façon, mais rendre un chemin inutilisable ferait afficher des images
         -- cassées au lieu d'aperçus marqués.
         case when v_net then m.preview_clair_path else null end,
         m.width, m.height,
         count(*) over () as total,
         v_max as visibles
  from media_assets m
  where m.album_id = r.album_id
    and m.status = 'ready'
    and m.thumb_path is not null
  order by m.position, m.created_at, m.id
  limit v_page
  offset v_debut;
end;
$function$
;
