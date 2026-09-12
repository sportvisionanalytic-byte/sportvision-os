-- v180 : la galerie d'un tournoi dit enfin de quel tournoi il s'agit (12/09/2026).
--
-- Avant la première vente de galeries de tournoi. media_gallery_open() rendait le nom du club et
-- celui de l'équipe, mais jamais `structure_externe`, la colonne qui porte précisément le nom
-- d'une structure qui n'est pas cliente : un tournoi, un plateau, un club adverse. Sur ces
-- galeries, la page d'accueil du visiteur n'affichait donc ni club, ni équipe, ni rien, et le pied
-- de page se terminait par un point médian orphelin : « Photographies réalisées par SportVision · ».
--
-- La colonne s'ajoute à la fin de ce que la fonction rend déjà : les écrans qui ne la lisent pas
-- continuent de fonctionner sans changement.
-- Test : tests/galerie-tournoi-sans-club.test.sh

drop function if exists public.media_gallery_open(text, text, text);
CREATE OR REPLACE FUNCTION public.media_gallery_open(p_slug text, p_token text, p_password text DEFAULT NULL::text)
 RETURNS TABLE(valide boolean, raison text, album_id uuid, titre text, event_date date, club_nom text, equipe text, structure text, cover_url text, photo_count integer, mot_de_passe_requis boolean, livraison_externe boolean, watermark boolean, offres jsonb, apercu_limite integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_offres jsonb;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);

  if r.raison is not null then
    return query select false, r.raison, null::uuid, null::text, null::date, null::text, null::text, null::text,
                        null::text, null::integer, (r.raison = 'mot_de_passe'), null::boolean,
                        null::boolean, null::jsonb, null::integer;
    return;
  end if;

  -- Un tableau, éventuellement vide : la page distingue « ce lien ne vend rien » (galerie de
  -- consultation) de « ce lien vend trois formules », sans second appel.
  select coalesce(jsonb_agg(jsonb_build_object(
           'offer_id', x.offer_id,
           'product_id', x.product_id,
           'type', x.offer_type,
           'name', x.offer_name,
           'price_cents', x.price_cents,
           'currency', x.currency,
           'photos_allowance', x.photos_allowance,
           'featured', x.is_featured
         ) order by x.display_order, x.price_cents), '[]'::jsonb)
  into v_offres
  from media_link_offers(r.link_id) x;

  return query
  select true, null::text, a.id, a.title, a.event_date, c.nom, t.name, a.structure_externe, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         false,
         (a.secure_collection_ref is not null
          and not exists (select 1 from media_assets m where m.album_id = a.id and m.status = 'ready')),
         a.watermark_previews,
         v_offres,
         _media_gallery_preview_limit(r.link_id)
  from media_albums a
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  where a.id = r.album_id;
end;
$function$;
