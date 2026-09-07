-- Migration : l'editeur de lien relit le drapeau d'essai
-- À exécuter APRÈS migration-galeries-v25-stats-exclusion.sql.
--
-- Sans ça, rouvrir un lien marqué comme essai afficherait la case décochée, et l'enregistrer le
-- réintégrerait silencieusement aux statistiques.

begin;

CREATE OR REPLACE FUNCTION public.media_link_editor(p_link_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare l record; v_offres jsonb;
begin
  select * into l from media_album_links where id = p_link_id;
  if not found then return null; end if;
  if not media_pricing_staff_album(l.album_id) and not media_upload_staff() then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'type', p.type, 'name', coalesce(o.label, p.name),
           'price_cents', coalesce(o.price_override_cents, p.price_cents),
           'photos_allowance', o.photos_allowance, 'display_order', o.display_order,
           'featured', o.is_featured, 'is_enabled', o.is_enabled
         ) order by o.display_order, o.created_at), '[]'::jsonb)
  into v_offres
  from media_album_link_offers o join media_products p on p.id = o.product_id
  where o.link_id = p_link_id;

  return jsonb_build_object(
    'id', l.id, 'album_id', l.album_id, 'slug', l.slug, 'token', l.token,
    'label', l.label, 'audience', l.audience, 'expires_at', l.expires_at,
    'is_enabled', l.is_enabled, 'preview_limit', l.preview_limit,
    'visible_in_clubplus', l.visible_in_clubplus,
    'analytics_excluded', l.analytics_excluded,
    'peut_tarifer', media_pricing_staff_album(l.album_id),
    'offres', v_offres
  );
end;
$function$
;

grant execute on function media_link_editor(uuid) to authenticated;

commit;
