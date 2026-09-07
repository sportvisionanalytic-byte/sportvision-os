-- Preuve qu'aucune limite commerciale n'est codée : six offres sur un lien, toutes adossées au
-- MÊME produit de catalogue, avec des quantités et des prix arbitraires, dont une offre gratuite
-- et un lien qui ne vend aucun album complet. Transaction annulée.
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_team uuid := 'bee719f7-d735-4a0b-b070-0d20eb73e7ec';
  v_saison uuid; v_album uuid; v_pack uuid; v_full uuid;
  lA uuid; lB uuid; lC uuid; sA text; tA text; sB text; tB text; sC text; tC text;
  i integer; v_ids uuid[] := '{}'; v_id uuid; v_n integer; q record; v_txt text;
  o17 uuid; o0 uuid;
begin
  select id into v_saison from saisons where label = '2026-2027';
  insert into media_albums (club_id, team_id, saison_id, title, status)
  values (v_club, v_team, v_saison, 'ZZ offres libres', 'published') returning id into v_album;

  for i in 1..80 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (v_album, v_club, 'media/'||v_album||'/'||i||'.jpg', 'p/'||i, 't/'||i, 'P'||i||'.JPG', 'ready', i)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- UN SEUL produit « selection de photos » au catalogue. Toutes les tailles de pack en
  -- decoulent : c'est l'offre qui porte la quantite, pas le catalogue.
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Selection de photos', 'pack', 999, 'eur', 'club', 'active', '{}')
  returning id into v_pack;
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Album complet', 'album_complet', 9999, 'eur', 'club', 'active', '{}')
  returning id into v_full;

  insert into media_album_links (album_id, slug, label) values (v_album, media_gallery_unique_slug('ZZ libres A'), 'Parents')
  returning id, slug, token into lA, sA, tA;

  -- Six offres, quantites et prix arbitraires, toutes sur le meme produit sauf la derniere.
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, v_pack,  600,  5, '5 photos',  1);
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, v_pack,  900, 12, '12 photos', 2);
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, v_pack, 1400, 25, '25 photos', 3);
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, v_pack, 1700, 17, '17 photos', 4) returning id into o17;
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, v_pack, 2200, 50, '50 photos', 5);
  insert into media_album_link_offers (link_id, product_id, price_override_cents, label, display_order, is_featured)
  values (lA, v_full, 3500, 'Galerie complete', 6, true);

  -- ── 1. Six offres, un seul produit ─────────────────────────────────────
  select count(*)::integer into v_n from media_link_offers(lA);
  insert into _res values ('1', 'six offres sur un lien', '6', v_n::text, v_n = 6);
  select count(distinct product_id)::integer into v_n from media_link_offers(lA);
  insert into _res values ('1', 'deux produits de catalogue suffisent', '2', v_n::text, v_n = 2);
  select jsonb_array_length(offres) into v_n from media_gallery_open(sA, tA);
  insert into _res values ('1', 'la page les recoit toutes', '6', v_n::text, v_n = 6);

  -- ── 2. Les quantites sont celles qu'on a saisies ───────────────────────
  select string_agg(photos_allowance::text, '/' order by display_order) into v_txt
  from media_link_offers(lA) where photos_allowance is not null;
  insert into _res values ('2', 'quotas rendus tels quels', '5/12/25/17/50', v_txt, v_txt = '5/12/25/17/50');
  select string_agg((price_cents/100)::text, '/' order by display_order) into v_txt from media_link_offers(lA);
  insert into _res values ('2', 'prix rendus tels quels (EUR)', '6/9/14/17/22/35', v_txt, v_txt = '6/9/14/17/22/35');

  -- 17 veut dire 17, pas « environ 15 parce que c'est un petit pack ».
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, v_ids[1:17], null, o17);
  insert into _res values ('2', 'pack 17 : 17 photos acceptees', '1 devis', v_n::text, v_n = 1);
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, v_ids[1:18], null, o17);
  insert into _res values ('2', 'pack 17 : 18 photos refusees', '0 devis', v_n::text, v_n = 0);
  select * into q from media_gallery_quote(sA, tA, v_ids[1:17], null, o17);
  insert into _res values ('2', 'et le prix reste celui saisi', '1700', q.total_cents::text, q.total_cents = 1700);

  -- ── 3. Une offre gratuite est valide ───────────────────────────────────
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, v_pack, 0, 3, '3 photos offertes', 0) returning id into o0;
  select price_cents into v_n from media_link_offers(lA) where offer_id = o0;
  insert into _res values ('3', 'offre a 0 EUR acceptee', '0', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_link_offers(lA);
  insert into _res values ('3', 'sept offres desormais', '7', v_n::text, v_n = 7);

  -- ── 4. Un lien sans album complet ──────────────────────────────────────
  insert into media_album_links (album_id, slug, label) values (v_album, media_gallery_unique_slug('ZZ libres B'), 'Sans album')
  returning id, slug, token into lB, sB, tB;
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, display_order)
  values (lB, v_pack, 1000, 10, 1);
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, display_order)
  values (lB, v_pack, 1500, 20, 2);
  select count(*)::integer into v_n from media_link_offers(lB) where offer_type = 'album_complet';
  insert into _res values ('4', 'aucune offre album complet : permis', '0', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_link_offers(lB);
  insert into _res values ('4', 'et le lien vend quand meme', '2', v_n::text, v_n = 2);

  -- ── 5. Un lien avec uniquement l'album complet ──────────────────────────
  insert into media_album_links (album_id, slug, label) values (v_album, media_gallery_unique_slug('ZZ libres C'), 'Album seul')
  returning id, slug, token into lC, sC, tC;
  insert into media_album_link_offers (link_id, product_id, price_override_cents, display_order)
  values (lC, v_full, 2700, 1);
  select count(*)::integer into v_n from media_link_offers(lC);
  insert into _res values ('5', 'une seule offre : permis', '1', v_n::text, v_n = 1);
  -- Offre unique : le visiteur n'a pas a la designer, il n'y a pas de choix a faire.
  select * into q from media_gallery_quote(sC, tC, null, null, null);
  insert into _res values ('5', 'offre unique : devis sans la designer', '2700 / 80 photos',
    q.total_cents||' / '||coalesce(array_length(q.valid_asset_ids,1),0)||' photos',
    q.total_cents = 2700 and array_length(q.valid_asset_ids,1) = 80);

  -- ── 6. Ordre et mise en avant viennent de la configuration ─────────────
  select offer_name into v_txt from media_link_offers(lA) where is_featured limit 1;
  insert into _res values ('6', 'la mise en avant est celle configuree', 'Galerie complete', v_txt, v_txt = 'Galerie complete');
  -- Et surtout : ce n'est PAS deduit du prix le plus eleve.
  update media_album_link_offers set is_featured = false where link_id = lA;
  update media_album_link_offers set is_featured = true where link_id = lA and photos_allowance = 12;
  select offer_name into v_txt from media_link_offers(lA) where is_featured limit 1;
  insert into _res values ('6', 'on peut mettre en avant une offre bon marche', '12 photos', v_txt, v_txt = '12 photos');
  select offer_name into v_txt from media_link_offers(lA) order by display_order limit 1;
  insert into _res values ('6', 'l ordre affiche est celui configure', '3 photos offertes', v_txt, v_txt = '3 photos offertes');
end $$;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
