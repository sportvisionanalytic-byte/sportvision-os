-- L'adresse publique d'une galerie doit nommer la GALERIE, pas le lien.
--
-- media_link_save fabriquait le slug a partir du libelle du lien, et retombait sur le titre de la
-- galerie seulement si ce libelle etait vide :
--
--     media_gallery_unique_slug(coalesce(p_label, (select title from media_albums ...)))
--
-- Tant que le libelle etait saisi a la main, cela passait. Depuis que le lien principal est cree
-- automatiquement avec le libelle « Lien principal », l'adresse envoyee aux familles est devenue
--
--     connect.sportvision-an.fr/gallery/lien-principal?k=...
--
-- au lieu de /gallery/testing-match-vc. Constate sur une vraie galerie creee par Fouka. Le slug
-- finit sur une affiche, dans un QR code et dans un message WhatsApp : il doit dire de quoi il
-- s'agit. Le libelle du lien, lui, reste interne — c'est ce qui distingue « Parents du club » de
-- « Equipe adverse » dans l'OS, et le visiteur ne le voit jamais.
--
-- Le slug est donc desormais tire du titre de la galerie, avec le libelle en repli si le titre
-- venait a manquer. Les slugs EXISTANTS ne changent pas : ils ne sont poses qu'a la creation, et
-- des parents ont deja le lien.

CREATE OR REPLACE FUNCTION public.media_link_save(p_album_id uuid, p_offers jsonb DEFAULT '[]'::jsonb, p_link_id uuid DEFAULT NULL::uuid, p_label text DEFAULT NULL::text, p_audience text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_is_enabled boolean DEFAULT true, p_preview_limit integer DEFAULT NULL::integer, p_visible_in_clubplus boolean DEFAULT false)
 RETURNS TABLE(ok boolean, raison text, link_id uuid, slug text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_club uuid;
  v_link uuid;
  v_slug text;
  v_token text;
  o jsonb;
  v_type text;
  v_nom text;
  v_prix integer;
  v_quota integer;
  v_produit uuid;
  v_featured integer := 0;
  i integer := 0;
  v_offre uuid;
  v_gardees uuid[];
begin
  if not media_pricing_staff_album(p_album_id) then
    return query select false, 'non_autorise', null::uuid, null::text, null::text;
    return;
  end if;

  -- L'ABSENCE DE CLUB N'EST PAS L'ABSENCE D'ALBUM. Avant ce lot, les deux etaient confondus :
  -- une galerie sans club se voyait refuser son lien avec « album_introuvable », un message faux
  -- qui ne disait rien de la vraie cause. On teste donc l'existence, et le club reste facultatif.
  if not exists (select 1 from media_albums where id = p_album_id) then
    return query select false, 'album_introuvable', null::uuid, null::text, null::text;
    return;
  end if;
  select club_id into v_club from media_albums where id = p_album_id;

  -- ── Validation AVANT toute écriture ──
  -- On refuse la configuration entière plutôt que d'en écrire une partie : un lien qui vend six
  -- formules sur sept est pire qu'un lien qu'on n'a pas pu enregistrer.
  for o in select * from jsonb_array_elements(coalesce(p_offers, '[]'::jsonb)) loop
    i := i + 1;
    v_type := o->>'type';
    v_nom := nullif(btrim(coalesce(o->>'name', '')), '');
    v_prix := (o->>'price_cents')::integer;
    v_quota := nullif(o->>'photos_allowance', '')::integer;

    if v_type not in ('pack', 'album_complet') then
      return query select false, 'offre_' || i || ' : type inconnu', null::uuid, null::text, null::text; return;
    end if;
    if v_nom is null then
      return query select false, 'offre_' || i || ' : nom manquant', null::uuid, null::text, null::text; return;
    end if;
    -- 0 est un prix VALIDE : une galerie peut être offerte. C'est `null` qui est refusé.
    if v_prix is null or v_prix < 0 then
      return query select false, 'offre_' || i || ' : prix invalide', null::uuid, null::text, null::text; return;
    end if;
    if v_type = 'pack' and (v_quota is null or v_quota < 1) then
      return query select false, 'offre_' || i || ' : nombre de photos manquant', null::uuid, null::text, null::text; return;
    end if;
    if coalesce((o->>'featured')::boolean, false) then v_featured := v_featured + 1; end if;
  end loop;

  if v_featured > 1 then
    return query select false, 'une seule offre peut être mise en avant', null::uuid, null::text, null::text; return;
  end if;

  -- ── Écriture ──
  if p_link_id is null then
    insert into media_album_links (album_id, slug, label, audience, expires_at, is_enabled, preview_limit, visible_in_clubplus, created_by)
    values (p_album_id, media_gallery_unique_slug(coalesce((select nullif(btrim(title),'') from media_albums where id = p_album_id), p_label)),
            p_label, p_audience, p_expires_at, coalesce(p_is_enabled, true), p_preview_limit,
            coalesce(p_visible_in_clubplus, false), auth.uid())
    returning id, media_album_links.slug, media_album_links.token into v_link, v_slug, v_token;
  else
    update media_album_links
    set label = p_label,
        audience = p_audience,
        expires_at = p_expires_at,
        is_enabled = coalesce(p_is_enabled, true),
        preview_limit = p_preview_limit,
        visible_in_clubplus = coalesce(p_visible_in_clubplus, false),
        updated_at = now()
    where id = p_link_id and album_id = p_album_id
    returning id, media_album_links.slug, media_album_links.token into v_link, v_slug, v_token;
    if v_link is null then
      return query select false, 'lien_introuvable', null::uuid, null::text, null::text; return;
    end if;
    -- Le slug et le jeton ne changent JAMAIS à la modification : des parents ont déjà le lien.
  end if;

  -- Les offres sont remplacées d'un bloc : c'est ce que l'écran montre, et gérer des différences
  -- ligne à ligne ferait diverger l'affichage de ce qui est réellement enregistré. Les commandes
  -- passées gardent leur montant, elles ne relisent jamais l'offre (media_orders.amount_cents).
  -- Les offres sont RECONCILIEES, jamais remplacees en bloc : voir l'en-tete de la migration v22.
  -- Supprimer puis reinserer effacait l'attribution de toutes les ventes passees, en silence.
  v_gardees := '{}';
  i := 0;
  for o in select * from jsonb_array_elements(coalesce(p_offers, '[]'::jsonb)) loop
    i := i + 1;
    v_type := o->>'type';
    -- Sans club, aucun produit de catalogue n'est cree : cela fabriquerait une ligne orpheline
    -- pour chaque adversaire photographie une seule fois. L'offre porte alors elle-meme son nom,
    -- son quota et son prix — c'est exactement ce que media_link_offers sait lire depuis la v32.
    v_produit := case when v_club is null then null else media_link_type_product(v_club, v_type) end;
    v_offre := nullif(o->>'id','')::uuid;

    if v_offre is not null and exists (
      select 1 from media_album_link_offers x where x.id = v_offre and x.link_id = v_link
    ) then
      update media_album_link_offers x
      set product_id = v_produit,
          offer_type = v_type,
          price_override_cents = (o->>'price_cents')::integer,
          photos_allowance = case when v_type = 'pack' then nullif(o->>'photos_allowance','')::integer end,
          label = btrim(o->>'name'),
          display_order = coalesce((o->>'display_order')::integer, i),
          is_featured = coalesce((o->>'featured')::boolean, false),
          is_enabled = coalesce((o->>'is_enabled')::boolean, true)
      where x.id = v_offre;
    else
      insert into media_album_link_offers (
        link_id, product_id, offer_type, price_override_cents, photos_allowance, label,
        display_order, is_featured, is_enabled, created_by
      ) values (
        v_link, v_produit, v_type, (o->>'price_cents')::integer,
        case when v_type = 'pack' then nullif(o->>'photos_allowance','')::integer end,
        btrim(o->>'name'),
        coalesce((o->>'display_order')::integer, i),
        coalesce((o->>'featured')::boolean, false),
        coalesce((o->>'is_enabled')::boolean, true),
        auth.uid()
      ) returning id into v_offre;
    end if;
    v_gardees := v_gardees || v_offre;
  end loop;

  -- Retiree de l'ecran mais DEJA VENDUE : desactivee, pas supprimee. Elle disparait du public et
  -- son chiffre d'affaires reste attribue.
  update media_album_link_offers x
  set is_enabled = false
  where x.link_id = v_link
    and not (x.id = any (v_gardees))
    and exists (select 1 from media_orders mo where mo.offer_id = x.id);

  -- Retiree et jamais vendue : rien a conserver.
  delete from media_album_link_offers x
  where x.link_id = v_link
    and not (x.id = any (v_gardees))
    and not exists (select 1 from media_orders mo where mo.offer_id = x.id);

  return query select true, null::text, v_link, v_slug, v_token;
end;
$function$
;
