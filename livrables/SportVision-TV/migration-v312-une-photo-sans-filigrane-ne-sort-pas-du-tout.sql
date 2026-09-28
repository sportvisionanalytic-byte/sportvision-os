-- v312 — 27/09/2026 : j'ai regarde les fichiers, et ma correction de la veille ne suffisait pas
--
-- LA v311 PARIAIT, CELLE-CI MESURE. Hier j'ai fait servir la VIGNETTE a la place de l'apercu pour les
-- 31 photos dont le drapeau `preview_watermarked` vaut false, en ecrivant qu'elle etait « trop petite
-- pour valoir un vol ». Je n'avais pas regarde les fichiers.
--
-- Aujourd'hui je les ai telecharges et ouverts :
--
--     apercu d'une photo marquee (27/09)    filigrane SPORTVISION en diagonale, tres visible
--     vignette d'une photo marquee          filigrane aussi
--     apercu d'une des 31                   AUCUN filigrane, 1067 x 1600, propre
--     vignette d'une des 31                 AUCUN filigrane non plus
--
-- Sur ces photos-la, le filigrane a echoue sur les DEUX derives. Ma substitution servait donc encore
-- une image propre, simplement plus petite — un vol moins rentable, pas un vol empeche.
--
-- ET LE DRAPEAU N'EST PAS UNE MESURE. Le code de l'OS ecrit `preview_watermarked: true` EN DUR a
-- chaque depot : il affirme que le filigrane a ete dessine, il ne le verifie pas. Les 31 ne sont donc
-- pas « les photos dont on sait qu'elles sont nues », ce sont « les photos d'avant la v282 ». Si le
-- dessin echouait aujourd'hui, le drapeau dirait quand meme true. C'est une dette notee ici, et la
-- seule verification qui vaille reste d'ouvrir un fichier.
--
-- CE QUI EST FAIT : tant que l'apercu n'est pas regenere, la photo ne sort PAS de la galerie
-- publique. Le client voit quinze photos au lieu de seize — c'est honnete — et jamais une photo
-- propre qu'il n'a pas payee. Le garde-fou est conditionne au drapeau : la regeneration remet la
-- photo en ligne toute seule.
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
         m.preview_path,
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
    -- v312, 27/09/2026 — UNE PHOTO SANS FILIGRANE N'EST PAS MONTREE DU TOUT.
    --
    -- La v311 servait la VIGNETTE a la place de l'apercu, en pariant qu'elle etait filigranee et
    -- trop petite pour valoir un vol. J'ai fini par REGARDER les fichiers, et le pari etait faux :
    -- sur ces photos-la le filigrane a echoue sur les DEUX derives. La vignette est propre elle
    -- aussi, simplement plus petite. Je servais donc toujours une image volable.
    --
    -- Tant que l'apercu n'est pas regenere, la photo sort de la galerie publique. Le client voit
    -- quinze photos au lieu de seize, ce qui est honnete ; il ne voit jamais une photo propre qu'il
    -- n'a pas payee. Ceux qui ont le droit de voir en clair (staff, club, acheteur) ne sont pas
    -- concernes par ce filtre.
    --
    -- Le garde-fou s'efface tout seul : il est conditionne au drapeau, donc la regeneration depuis
    -- l'OS remet la photo en ligne sans qu'on retouche au code.
    and (v_net or m.preview_watermarked is true)
  order by m.position, m.created_at, m.id
  limit v_page
  offset v_debut;
end;
$function$
;
