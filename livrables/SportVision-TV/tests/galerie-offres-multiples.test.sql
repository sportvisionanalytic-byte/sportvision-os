-- Le cas tournoi : un lien, trois formules, sélection AVANT paiement. Transaction annulée.
--
-- Galerie de 30 photos, avec les offres que Fouka a décrites :
--   Pack 10  → 10 €      Pack 20 → 15 €      Galerie complète → 30 €
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
grant all on _res to authenticated;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_team uuid := 'bee719f7-d735-4a0b-b070-0d20eb73e7ec';
  v_saison uuid; v_album uuid;
  p10 uuid; p20 uuid; pfull uuid;
  o10 uuid; o20 uuid; ofull uuid;
  lA uuid; lB uuid; sA text; tA text; sB text; tB text;
  i integer; v_ids uuid[] := '{}'; v_id uuid;
  q record; v_n integer; v_autre uuid;
begin
  select id into v_saison from saisons where label = '2026-2027';
  insert into media_albums (club_id, team_id, saison_id, title, status)
  values (v_club, v_team, v_saison, 'ZZ tournoi U12', 'published') returning id into v_album;

  for i in 1..30 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (v_album, v_club, 'media/'||v_album||'/'||i||'.jpg', 'p/'||i, 't/'||i, 'P'||i||'.JPG', 'ready', i)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Un SEUL produit « pack » au catalogue : c'est l'offre du lien qui dit combien de photos.
  -- C'est tout l'objet du lot — 10 EUR ne veut pas dire « toujours 15 photos ».
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Pack photos', 'pack', 1200, 'eur', 'club', 'active', '{"photo_count":15}')
  returning id into p10;
  p20 := p10;
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Galerie complete', 'album_complet', 5000, 'eur', 'club', 'active', '{}')
  returning id into pfull;
  -- Second produit pack, pour pouvoir mettre deux packs sur le meme lien.
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Pack photos +', 'pack', 1800, 'eur', 'club', 'active', '{"photo_count":30}')
  returning id into p20;

  insert into media_album_links (album_id, slug, label, audience)
  values (v_album, media_gallery_unique_slug('ZZ tournoi parents'), 'Parents', 'club_partenaire')
  returning id, slug, token into lA, sA, tA;
  insert into media_album_links (album_id, slug, label, audience)
  values (v_album, media_gallery_unique_slug('ZZ tournoi adverse'), 'Adverse', 'equipe_adverse')
  returning id, slug, token into lB, sB, tB;

  -- Lien parents : 10 photos a 10 EUR, 20 photos a 15 EUR, tout a 30 EUR.
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, p10, 1000, 10, '10 photos au choix', 1) returning id into o10;
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order)
  values (lA, p20, 1500, 20, '20 photos au choix', 2) returning id into o20;
  insert into media_album_link_offers (link_id, product_id, price_override_cents, label, display_order, is_featured)
  values (lA, pfull, 3000, 'Toute la galerie', 3, true) returning id into ofull;

  -- Lien adverse : memes photos, tarifs plus eleves.
  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, display_order)
  values (lB, p10, 1500, 10, 1);
  insert into media_album_link_offers (link_id, product_id, price_override_cents, display_order)
  values (lB, pfull, 5000, 2) returning id into v_autre;

  -- ── 1. Le lien propose bien trois formules ─────────────────────────────
  select count(*)::integer into v_n from media_link_offers(lA);
  insert into _res values ('1', 'le lien parents propose 3 formules', '3', v_n::text, v_n = 3);

  select jsonb_array_length(offres) into v_n from media_gallery_open(sA, tA);
  insert into _res values ('1', 'la page les recoit a l ouverture', '3', v_n::text, v_n = 3);

  select price_cents into v_n from media_link_offers(lA) where offer_id = o10;
  insert into _res values ('1', 'le prix du LIEN prime sur le catalogue', '1000 (et non 1200)', v_n::text, v_n = 1000);
  select photos_allowance into v_n from media_link_offers(lA) where offer_id = o10;
  insert into _res values ('1', 'le quota du LIEN prime sur le produit', '10 (et non 15)', v_n::text, v_n = 10);
  select photos_allowance into v_n from media_link_offers(lA) where offer_id = ofull;
  insert into _res values ('1', 'la galerie complete n a pas de quota', 'NULL',
    coalesce(v_n::text,'NULL'), v_n is null);

  -- ── 2. Toutes les photos sont visibles avant achat ─────────────────────
  -- C'est indispensable sur un tournoi : sans ca le parent ne retrouve pas son enfant.
  select count(*)::integer into v_n from media_gallery_photos(sA, tA, null, 200, 0);
  insert into _res values ('2', 'les 30 photos sont parcourables avant achat', '30', v_n::text, v_n = 30);

  -- Mais un lien peut etre plafonne quand on ne veut pas tout exposer.
  update media_album_links set preview_limit = 5 where id = lB;
  select count(*)::integer into v_n from media_gallery_photos(sB, tB, null, 200, 0);
  insert into _res values ('2', 'un lien plafonne a 5 n en sert que 5', '5', v_n::text, v_n = 5);
  update media_album_links set preview_limit = null where id = lB;

  -- ── 3. Le prix ne bouge pas pendant la selection ───────────────────────
  select * into q from media_gallery_quote(sA, tA, v_ids[1:3], null, o10);
  insert into _res values ('3', 'pack 10 avec 3 photos : 10 EUR', '1000', q.total_cents::text, q.total_cents = 1000);
  select * into q from media_gallery_quote(sA, tA, v_ids[1:10], null, o10);
  insert into _res values ('3', 'pack 10 avec 10 photos : toujours 10 EUR', '1000', q.total_cents::text, q.total_cents = 1000);
  insert into _res values ('3', 'les 10 photos choisies sont retenues', '10',
    coalesce(array_length(q.valid_asset_ids,1),0)::text, array_length(q.valid_asset_ids,1) = 10);

  -- ── 4. Moins que le quota est permis, plus ne l est pas ────────────────
  -- Un parent qui ne trouve que 3 photos de son enfant doit pouvoir acheter quand meme.
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, v_ids[1:11], null, o10);
  insert into _res values ('4', 'pack 10 avec 11 photos : REFUSE', '0 devis', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, v_ids[1:20], null, o20);
  insert into _res values ('4', 'pack 20 avec 20 photos : accepte', '1 devis', v_n::text, v_n = 1);
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, v_ids[1:21], null, o20);
  insert into _res values ('4', 'pack 20 avec 21 photos : REFUSE', '0 devis', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, '{}', null, o10);
  insert into _res values ('4', 'pack sans aucune photo : REFUSE', '0 devis', v_n::text, v_n = 0);

  -- ── 5. La galerie complete ne demande aucune selection ─────────────────
  select * into q from media_gallery_quote(sA, tA, null, null, ofull);
  insert into _res values ('5', 'galerie complete : 30 EUR, 30 photos figees', '3000 / 30',
    q.total_cents||' / '||coalesce(array_length(q.valid_asset_ids,1),0),
    q.total_cents = 3000 and array_length(q.valid_asset_ids,1) = 30);

  -- ── 6. Les manipulations ───────────────────────────────────────────────
  -- L'offre d'un AUTRE lien ne doit pas s'appliquer ici : sinon il suffirait d'envoyer
  -- l'identifiant de l'offre la moins chere trouvee ailleurs.
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, null, null, v_autre);
  insert into _res values ('6', 'offre d un autre lien : REFUSEE', '0 devis', v_n::text, v_n = 0);

  select count(*)::integer into v_n from media_gallery_quote(sA, tA, null, null,
    '00000000-0000-0000-0000-000000000999');
  insert into _res values ('6', 'offre inventee : REFUSEE', '0 devis', v_n::text, v_n = 0);

  -- Une photo qui n'est pas de cet album ne doit jamais entrer dans la commande.
  select * into q from media_gallery_quote(sA, tA,
    v_ids[1:5] || '00000000-0000-0000-0000-000000000123'::uuid, null, o10);
  insert into _res values ('6', 'photo etrangere a l album : ecartee', '5 retenues',
    coalesce(array_length(q.valid_asset_ids,1),0)::text, array_length(q.valid_asset_ids,1) = 5);

  select count(*)::integer into v_n from media_gallery_quote(sA, 'jeton-faux', null, null, ofull);
  insert into _res values ('6', 'jeton invalide : REFUSE', '0 devis', v_n::text, v_n = 0);

  -- Aucun montant n'est lu depuis l'appelant : le parametre n'existe pas dans la signature.
  select * into q from media_gallery_quote(sA, tA, null, null, ofull);
  insert into _res values ('6', 'le prix vient de la base, jamais du client', '3000',
    q.total_cents::text, q.total_cents = 3000);

  -- ── 7. Desactivations ──────────────────────────────────────────────────
  update media_album_link_offers set is_enabled = false where id = o10;
  select count(*)::integer into v_n from media_link_offers(lA);
  insert into _res values ('7', 'offre desactivee : plus proposee', '2', v_n::text, v_n = 2);
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, v_ids[1:5], null, o10);
  insert into _res values ('7', 'offre desactivee : plus achetable', '0 devis', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, null, null, ofull);
  insert into _res values ('7', 'les autres formules continuent de fonctionner', '1 devis', v_n::text, v_n = 1);
  update media_album_link_offers set is_enabled = true where id = o10;

  update media_products set status = 'paused' where id = pfull;
  select count(*)::integer into v_n from media_link_offers(lA);
  insert into _res values ('7', 'produit retire du catalogue : offre retiree', '2', v_n::text, v_n = 2);
  update media_products set status = 'active' where id = pfull;

  update media_album_links set is_enabled = false where id = lA;
  select count(*)::integer into v_n from media_gallery_quote(sA, tA, null, null, ofull);
  insert into _res values ('7', 'lien desactive : plus aucun achat', '0 devis', v_n::text, v_n = 0);
  update media_album_links set is_enabled = true where id = lA;

  -- ── 8. Deux liens, deux grilles, un seul album ─────────────────────────
  select price_cents into v_n from media_link_offers(lA) where offer_id = o10;
  insert into _res values ('8', 'pack 10 cote parents : 10 EUR', '1000', v_n::text, v_n = 1000);
  select price_cents into v_n from media_link_offers(lB) where product_id = p10;
  insert into _res values ('8', 'le meme pack cote adverse : 15 EUR', '1500', v_n::text, v_n = 1500);
  insert into _res select '8', 'et les memes photos des deux cotes', '30 = 30',
    (select count(*) from media_gallery_photos(sA, tA, null, 200, 0))||' = '||
    (select count(*) from media_gallery_photos(sB, tB, null, 200, 0)),
    (select count(*) from media_gallery_photos(sA, tA, null, 200, 0)) =
    (select count(*) from media_gallery_photos(sB, tB, null, 200, 0));

  -- ── 9. Un lien sans offre reste une galerie de consultation ────────────
  delete from media_album_link_offers where link_id = lB;
  select jsonb_array_length(offres) into v_n from media_gallery_open(sB, tB);
  insert into _res values ('9', 'lien sans offre : aucune formule annoncee', '0', v_n::text, v_n = 0);
end $$;

-- ── 10. Qui peut préparer les offres ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
insert into _res select '10', 'Secretariat : PEUT preparer les offres (07/09 soir)', 'true', media_pricing_staff()::text, media_pricing_staff();
set local request.jwt.claims = '{"sub":"97a7f67a-baa0-41e8-a891-7751aec9fd76","role":"authenticated"}';
insert into _res select '10', 'Responsable Production : peut', 'true', media_pricing_staff()::text, media_pricing_staff();
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
insert into _res select '10', 'Fondateur : peut', 'true', media_pricing_staff()::text, media_pricing_staff();
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
insert into _res select '10', 'Photographe : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
insert into _res select '10', 'CM : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
set local request.jwt.claims = '{"sub":"b2d5b116-ab57-47fe-987e-22eb9dc41e83","role":"authenticated"}';
insert into _res select '10', 'Comptabilite : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
