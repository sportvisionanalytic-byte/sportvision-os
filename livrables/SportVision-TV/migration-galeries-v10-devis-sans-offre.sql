-- ═══════════════════════════════════════════════════════════════════════════════
-- Un lien de galerie sans aucune offre faisait planter le devis
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Trouve le 09/09/2026 en reparant les suites galerie. `media_gallery_quote` traitait le cas
-- « une offre » et le cas « plusieurs offres », mais pas le cas « aucune » : le record `o`
-- restait NON ASSIGNE, et la ligne `if o.offer_id is not null` levait
--
--   ERROR 55000 : record "o" is not assigned yet
--
-- Concretement : un visiteur ouvrant un lien dont les offres ont ete retirees ou desactivees
-- recevait une erreur serveur au lieu d'une galerie simplement non vendable. Trois suites de
-- tests le signalaient depuis un moment, sans que la cause soit identifiee.
--
-- Un lien sans offre n'a rien a vendre : on ne devine pas un prix, on ne renvoie rien.
CREATE OR REPLACE FUNCTION public.media_gallery_quote(p_slug text, p_token text, p_asset_ids uuid[] DEFAULT NULL::uuid[], p_password text DEFAULT NULL::text, p_offer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(album_id uuid, club_id uuid, saison_id uuid, link_id uuid, offer_id uuid, product_id uuid, offer_type text, offer_name text, valid_asset_ids uuid[], photos_allowance integer, total_cents integer, currency text, lines jsonb, whole_album boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  o record;
  v_album media_albums;
  v_valid uuid[];
  v_count integer;
  b record;
  v_currency text;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;
  select * into v_album from media_albums where media_albums.id = r.album_id;

  -- L'offre demandée doit appartenir À CE LIEN. Sans cette jointure, il suffirait d'envoyer
  -- l'identifiant de l'offre à 10 € d'un autre lien pour obtenir la galerie au tarif du voisin.
  if p_offer_id is not null then
    select * into o from media_link_offers(r.link_id) where media_link_offers.offer_id = p_offer_id;
    if not found then return; end if;
  else
    -- Aucune offre demandée : lien à offre unique, ou lien hérité. On prend la seule qu'il y a.
    -- S'il y en a plusieurs, on ne devine pas laquelle il voulait.
    select count(*)::integer into v_count from media_link_offers(r.link_id);
    if v_count = 1 then
      select * into o from media_link_offers(r.link_id);
    elsif v_count > 1 then
      return;
    else
      -- Aucune offre sur ce lien : il n'y a rien a vendre, on ne devine pas un prix.
      --
      -- Corrige le 09/09/2026. Ce cas n'etait pas traite : `o` restait NON ASSIGNE et la
      -- ligne « if o.offer_id is not null » plus bas levait « record "o" is not assigned yet ».
      -- Un visiteur ouvrant un lien dont les offres ont ete retirees recevait donc une erreur
      -- serveur au lieu d'une galerie sans possibilite d'achat. Trois suites de tests le
      -- signalaient deja sans que la cause soit identifiee.
      return;
    end if;
  end if;

  -- ── Modèle « formule » ────────────────────────────────────────────────────────────────
  -- La bascule se fait sur l'EXISTENCE D'UNE OFFRE, plus sur la présence d'un produit de
  -- catalogue. Depuis la v31, une offre peut se suffire à elle-même : elle porte son nom, son
  -- quota et son prix, et une galerie sans club n'a aucun produit à lui associer. Tester
  -- product_id faisait retomber ces offres sur le modèle historique par photo, qui exige un
  -- club — et rendait donc toute galerie autonome invendable, silencieusement.
  -- o.offer_id porte une vraie offre ; o.product_id seul désigne un lien d'avant les offres.
  if o.offer_id is not null or o.product_id is not null then
    if o.offer_type = 'album_complet' then
      -- Toutes les photos publiables AU MOMENT DE L'ACHAT. Une photo ajoutée après coup n'entre
      -- pas dans une commande déjà payée : sinon un album complété pendant des mois
      -- transformerait un achat de 50 € en abonnement à vie, que personne n'a vendu.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m where m.album_id = r.album_id and m.status = 'ready';
    else
      -- Pack : la sélection vient du visiteur, mais on ne garde que des photos réellement
      -- publiables de CET album. Une liste envoyée par le navigateur ne prouve rien.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m
      where m.album_id = r.album_id and m.status = 'ready'
        and m.id = any (coalesce(p_asset_ids, '{}'));

      v_count := coalesce(array_length(v_valid, 1), 0);
      -- Au-delà du quota, on ne rogne pas la sélection en silence : le visiteur croirait avoir
      -- acheté 20 photos et n'en recevrait que 15. On refuse, et l'écran le dit.
      if o.photos_allowance is not null and v_count > o.photos_allowance then return; end if;
      -- En dessous du quota, c'est permis : un parent qui ne trouve que 11 photos de son enfant
      -- sur un pack de 15 doit pouvoir acheter quand même. Le prix ne change pas.
      if v_count = 0 then return; end if;
    end if;

    return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id,
                        o.offer_id, o.product_id, o.offer_type, o.offer_name,
                        v_valid, o.photos_allowance, o.price_cents, coalesce(o.currency,'eur'),
                        jsonb_build_array(jsonb_build_object(
                          'product_id', o.product_id, 'name', o.offer_name, 'type', o.offer_type,
                          'quantity', 1, 'unit_price_cents', o.price_cents,
                          'covers_photos', coalesce(array_length(v_valid, 1), 0))),
                        (o.offer_type = 'album_complet');
    return;
  end if;

  -- ── Modèle historique : prix par combinaison sur une sélection ─────────────────────────
  -- Conservé tel quel pour les liens qui ne vendent aucune formule : ils existent encore.
  select coalesce(array_agg(m.id), '{}') into v_valid
  from media_assets m
  where m.album_id = r.album_id and m.status = 'ready' and m.id = any (coalesce(p_asset_ids, '{}'));

  v_count := coalesce(array_length(v_valid, 1), 0);
  if v_count = 0 then return; end if;

  select * into b from _media_gallery_best_price(r.album_id, v_count);
  if b.total_cents is null then return; end if;

  select p.currency into v_currency from media_products p
  where p.club_id = v_album.club_id and p.status = 'active' limit 1;

  return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id, null::uuid,
                      null::uuid, null::text, null::text, v_valid, null::integer, b.total_cents,
                      coalesce(v_currency, 'eur'), b.lines, b.whole_album;
end;
$function$;
