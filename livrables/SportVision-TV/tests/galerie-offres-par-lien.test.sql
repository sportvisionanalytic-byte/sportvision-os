begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
grant all on _res to authenticated;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_team uuid := 'bee719f7-d735-4a0b-b070-0d20eb73e7ec';
  v_saison uuid;
  v_album uuid;
  v_complet uuid; v_pack uuid; v_unite uuid;
  lA uuid; lB uuid; lC uuid;
  sA text; tA text; sB text; tB text; sC text; tC text;
  q record; p record; o record; r record;
  i integer; v_ids uuid[] := '{}'; v_id uuid;
  v_order uuid; v_grant text; v_txt text; v_n integer;
begin
  select id into v_saison from saisons where label = '2026-2027';
  insert into media_albums (club_id, team_id, saison_id, title, status)
  values (v_club, v_team, v_saison, 'ZZ offres', 'published') returning id into v_album;

  for i in 1..10 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (v_album, v_club, 'media/'||v_album||'/'||i||'.jpg', 'p/'||i, 't/'||i, 'P'||i||'.JPG', 'ready', i)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Galerie complete', 'album_complet', 3000, 'eur', 'club', 'active', '{}') returning id into v_complet;
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, '5 photos HD', 'pack', 900, 'eur', 'club', 'active', '{"photo_count":5}') returning id into v_pack;
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Photo a l unite', 'photo_unite', 400, 'eur', 'club', 'active', '{}') returning id into v_unite;

  -- Lien A : parents du club partenaire, galerie complete a 15 EUR (override)
  insert into media_album_links (album_id, slug, label, audience, product_id, price_override_cents)
  values (v_album, media_gallery_unique_slug('ZZ offres A'), 'Parents Villeneuve', 'club_partenaire', v_complet, 1500)
  returning id, slug, token into lA, sA, tA;
  -- Lien B : equipe adverse, meme produit, aucun override -> prix catalogue 30 EUR
  insert into media_album_links (album_id, slug, label, audience, product_id)
  values (v_album, media_gallery_unique_slug('ZZ offres B'), 'Gennevilliers', 'equipe_adverse', v_complet)
  returning id, slug, token into lB, sB, tB;
  -- Lien C : lien historique, aucune offre attachee
  insert into media_album_links (album_id, slug)
  values (v_album, media_gallery_unique_slug('ZZ offres C'))
  returning id, slug, token into lC, sC, tC;

  -- ── 1. Le meme album, deux prix ────────────────────────────────────────
  select * into p from media_gallery_products(sA, tA);
  insert into _res values ('1', 'lien club partenaire : 15 EUR', '1500 / Galerie complete',
    p.price_cents||' / '||p.name, p.price_cents = 1500);
  select count(*) into v_n from media_gallery_products(sA, tA);
  insert into _res values ('1', 'lien configure : une seule offre affichee', '1', v_n::text, v_n = 1);

  select * into p from media_gallery_products(sB, tB);
  insert into _res values ('1', 'lien equipe adverse : 30 EUR (prix catalogue)', '3000',
    p.price_cents::text, p.price_cents = 3000);

  select count(*) into v_n from media_gallery_products(sC, tC);
  select count(*) into i from media_products where club_id = v_club and status = 'active';
  insert into _res values ('1', 'lien historique : tout le catalogue actif du club', i::text, v_n::text, v_n = i);

  -- ── 2. Les photos sont les memes ───────────────────────────────────────
  insert into _res select '2', 'les deux liens montrent les memes photos', '10 = 10',
    (select count(*) from media_gallery_photos(sA, tA))||' = '||(select count(*) from media_gallery_photos(sB, tB)),
    (select count(*) from media_gallery_photos(sA, tA)) = (select count(*) from media_gallery_photos(sB, tB));

  -- ── 3. Devis ferme : le prix vient du lien, pas de la selection ────────
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('3', 'devis lien A sans selection : 15 EUR, album complet', '1500 / album_complet / 10 photos',
    q.total_cents||' / '||q.offer_type||' / '||coalesce(array_length(q.valid_asset_ids,1),0)||' photos',
    q.total_cents = 1500 and q.offer_type = 'album_complet' and array_length(q.valid_asset_ids,1) = 10);

  select * into q from media_gallery_quote(sB, tB, null);
  insert into _res values ('3', 'devis lien B : 30 EUR', '3000', q.total_cents::text, q.total_cents = 3000);

  -- Le jeton A avec une selection ne change rien : le prix ne depend plus des photos.
  select * into q from media_gallery_quote(sA, tA, v_ids[1:3]);
  insert into _res values ('3', 'jeton A + selection de 3 photos : toujours 15 EUR', '1500',
    q.total_cents::text, q.total_cents = 1500);

  -- ── 4. Pack : allowance, aucune photo figee a l achat ──────────────────
  update media_album_links set product_id = v_pack, price_override_cents = null where id = lA;
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('4', 'pack 5 : 9 EUR, 5 photos a choisir, 0 figee', '900 / 5 / 0',
    q.total_cents||' / '||q.photos_allowance||' / '||coalesce(array_length(q.valid_asset_ids,1),0),
    q.total_cents = 900 and q.photos_allowance = 5 and coalesce(array_length(q.valid_asset_ids,1),0) = 0);

  -- ── 5. Selection APRES paiement, verifiee cote serveur ─────────────────
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status, photos_allowance, product_id, paid_at)
  values (v_club, v_album, lA, 'parent@exemple.fr', 900, 'eur', 'paid', 5, v_pack, now()) returning id into v_order;
  insert into media_download_grants (order_id, email) values (v_order, 'parent@exemple.fr') returning token into v_grant;

  select * into r from media_gallery_order_select(v_grant, v_ids[1:8]);
  insert into _res values ('5', 'pack de 5 : 8 photos demandees -> refuse', 'trop_de_photos',
    coalesce(r.raison,'ACCEPTE'), r.raison = 'trop_de_photos');

  select * into r from media_gallery_order_select(v_grant, array['00000000-0000-0000-0000-000000000123'::uuid]);
  insert into _res values ('5', 'photo etrangere a l album : refusee', 'aucune_photo',
    coalesce(r.raison,'ACCEPTE'), r.raison = 'aucune_photo');

  select * into r from media_gallery_order_select(v_grant, v_ids[1:5]);
  insert into _res values ('5', '5 photos valides : acceptees', 'ok / 5',
    r.ok||' / '||r.selectionnees, r.ok and r.selectionnees = 5);

  select * into r from media_gallery_order_select(v_grant, v_ids[6:10]);
  insert into _res values ('5', 'seconde selection : refusee (choix definitif)', 'deja_choisie',
    coalesce(r.raison,'ACCEPTE'), r.raison = 'deja_choisie');

  -- ── 6. Recapitulatif ───────────────────────────────────────────────────
  select album_titre||' / '||photos_allowance||' / '||selection_faite||' / '||jsonb_array_length(photos) into v_txt
  from media_gallery_order_summary(v_grant);
  insert into _res values ('6', 'recapitulatif : titre, quota, selection faite, 5 photos',
    'ZZ offres / 5 / true / 5', v_txt, v_txt = 'ZZ offres / 5 / true / 5');

  -- ── 7. Attribution au lien ─────────────────────────────────────────────
  -- Lecture verifiee plus bas en tant qu'admin : media_album_links_stats est reservee aux roles
  -- commerciaux, et l'appelant de ce bloc n'a pas d'identite applicative.
  select count(*)::integer into v_n from media_orders where link_id = lA and status = 'paid';
  select sum(amount_cents)::integer into i from media_orders where link_id = lA and status = 'paid';
  insert into _res values ('7', 'commande attribuee au lien', '1 vente / 900 c',
    v_n||' vente / '||i||' c', v_n = 1 and i = 900);

  -- ── 8. Changer le prix du lien n affecte pas la commande passee ────────
  update media_album_links set price_override_cents = 2000 where id = lA;
  select amount_cents into v_n from media_orders where id = v_order;
  insert into _res values ('8', 'commande deja payee : montant inchange', '900', v_n::text, v_n = 900);
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('8', 'nouveau checkout : nouveau prix', '2000', q.total_cents::text, q.total_cents = 2000);

  -- ── 9. Produit desactive : le lien cesse de vendre ─────────────────────
  update media_products set status = 'paused' where id = v_pack;
  select count(*) into v_n from media_gallery_products(sA, tA);
  insert into _res values ('9', 'produit desactive : plus aucune offre sur ce lien', '0', v_n::text, v_n = 0);
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('9', 'produit desactive : aucun devis possible', 'NULL',
    coalesce(q.total_cents::text,'NULL'), q.total_cents is null);
  update media_products set status = 'active' where id = v_pack;

  -- ── 10. Lien desactive ─────────────────────────────────────────────────
  update media_album_links set is_enabled = false where id = lA;
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('10', 'lien desactive : aucun nouvel achat', 'NULL',
    coalesce(q.total_cents::text,'NULL'), q.total_cents is null);
  select count(*) into v_n from media_gallery_order_summary(v_grant);
  insert into _res values ('10', 'lien desactive : la commande deja payee reste accessible', '1', v_n::text, v_n = 1);
end $$;

-- ── 11. Permissions ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
insert into _res select '11', 'photographe : ne peut pas fixer un prix', 'false', media_pricing_staff()::text, not media_pricing_staff();
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
insert into _res select '11', 'CM : ne peut pas fixer un prix', 'false', media_pricing_staff()::text, not media_pricing_staff();
set local request.jwt.claims = '{"sub":"97a7f67a-baa0-41e8-a891-7751aec9fd76","role":"authenticated"}';
insert into _res select '11', 'responsable production : peut fixer un prix', 'true', media_pricing_staff()::text, media_pricing_staff();
set local request.jwt.claims = '{"sub":"3259409d-b69f-4780-877c-b75e0e8d663d","role":"authenticated"}';
insert into _res select '11', 'admin : peut fixer un prix', 'true', media_pricing_staff()::text, media_pricing_staff();
reset role;

select n, cas, attendu, obtenu, ok from _res order by n::text, cas;

rollback;
