-- Le parcours « formule » de bout en bout, sur la vraie base et les vraies fonctions deployees.
-- Rien n'est encaisse : la commande est placee dans l'etat « payee » comme le fait le webhook,
-- puis on rejoue ce que fait le visiteur. Transaction annulee a la fin.
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
-- media_album_links_stats est reservee aux roles commerciaux (media_pricing_staff, v7). Le bloc
-- DO n'a aucune identite applicative : il faut donc verifier l'attribution en tant qu'admin, plus
-- bas. On garde ici de quoi retrouver l'album et ses liens.
create temp table _ctx(album uuid, lien_a uuid, lien_c uuid) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_team uuid := 'bee719f7-d735-4a0b-b070-0d20eb73e7ec';
  v_saison uuid;
  v_album uuid;
  v_complet uuid; v_pack uuid;
  lA uuid; lB uuid; lC uuid;
  sA text; tA text; sB text; tB text; sC text; tC text;
  o record; q record; r record;
  i integer; v_ids uuid[] := '{}'; v_id uuid;
  v_order uuid; v_grant text; v_n integer; v_txt text;
begin
  select id into v_saison from saisons where label = '2026-2027';
  insert into media_albums (club_id, team_id, saison_id, title, status)
  values (v_club, v_team, v_saison, 'ZZ parcours formules', 'published') returning id into v_album;

  for i in 1..12 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (v_album, v_club, 'media/'||v_album||'/'||i||'.jpg', 'p/'||i, 't/'||i, 'P'||i||'.JPG', 'ready', i)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Galerie complete', 'album_complet', 3000, 'eur', 'club', 'active', '{}') returning id into v_complet;
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, '5 photos HD', 'pack', 900, 'eur', 'club', 'active', '{"photo_count":5}') returning id into v_pack;

  insert into media_album_links (album_id, slug, label, audience, product_id, price_override_cents)
  values (v_album, media_gallery_unique_slug('ZZ formules A'), 'Parents', 'club_partenaire', v_complet, 1500)
  returning id, slug, token into lA, sA, tA;
  insert into media_album_links (album_id, slug, label, audience, product_id)
  values (v_album, media_gallery_unique_slug('ZZ formules B'), 'Adverse', 'equipe_adverse', v_pack)
  returning id, slug, token into lB, sB, tB;
  insert into media_album_links (album_id, slug)
  values (v_album, media_gallery_unique_slug('ZZ formules C'))
  returning id, slug, token into lC, sC, tC;

  -- ── 1. La page sait, des l'ouverture, ce que son lien vend ─────────────
  select * into o from media_gallery_open(sA, tA);
  insert into _res values ('1', 'lien galerie complete : offre annoncee a l ouverture',
    'album_complet / 1500', (o.offre->>'type')||' / '||(o.offre->>'price_cents'),
    o.offre->>'type' = 'album_complet' and (o.offre->>'price_cents')::int = 1500);
  insert into _res values ('1', 'offre vendable', 'true', o.offre->>'available', (o.offre->>'available')::boolean);

  select * into o from media_gallery_open(sB, tB);
  insert into _res values ('1', 'lien pack : quota annonce, prix catalogue', '5 / 900',
    (o.offre->>'photos_allowance')||' / '||(o.offre->>'price_cents'),
    (o.offre->>'photos_allowance')::int = 5 and (o.offre->>'price_cents')::int = 900);

  select * into o from media_gallery_open(sC, tC);
  insert into _res values ('1', 'lien historique : aucune offre, ancien parcours', 'NULL',
    coalesce(o.offre::text,'NULL'), o.offre is null);

  -- ── 2. Le meme album, deux prix, les memes photos ──────────────────────
  insert into _res select '2', 'memes photos des deux cotes', '12 = 12',
    (select count(*) from media_gallery_photos(sA, tA))||' = '||(select count(*) from media_gallery_photos(sB, tB)),
    (select count(*) from media_gallery_photos(sA, tA)) = (select count(*) from media_gallery_photos(sB, tB));

  -- ── 3. Payer sans avoir rien selectionne ───────────────────────────────
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('3', 'galerie complete : devis sans selection, 12 photos figees', '1500 / 12',
    q.total_cents||' / '||coalesce(array_length(q.valid_asset_ids,1),0),
    q.total_cents = 1500 and array_length(q.valid_asset_ids,1) = 12);

  select * into q from media_gallery_quote(sB, tB, null);
  insert into _res values ('3', 'pack : devis sans selection, aucune photo figee', '900 / 5 / 0',
    q.total_cents||' / '||q.photos_allowance||' / '||coalesce(array_length(q.valid_asset_ids,1),0),
    q.total_cents = 900 and q.photos_allowance = 5 and coalesce(array_length(q.valid_asset_ids,1),0) = 0);

  -- Le prix ne depend plus de ce que le visiteur coche : c'est tout l'objet du changement.
  select * into q from media_gallery_quote(sA, tA, v_ids[1:3]);
  insert into _res values ('3', 'selection de 3 photos : prix inchange', '1500', q.total_cents::text, q.total_cents = 1500);

  -- ── 4. Le pack, apres paiement ─────────────────────────────────────────
  insert into media_orders (club_id, album_id, link_id, product_id, photos_allowance, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, lB, v_pack, 5, 'parent@exemple.fr', 900, 'eur', 'paid', now()) returning id into v_order;
  insert into media_download_grants (order_id, email) values (v_order, 'parent@exemple.fr') returning token into v_grant;

  select count(*)::integer into v_n from media_gallery_order_choices(v_grant);
  insert into _res values ('4', 'l acheteur voit tout l album pour choisir', '12', v_n::text, v_n = 12);

  select total into v_n from media_gallery_order_choices(v_grant, 3, 0);
  insert into _res values ('4', 'pagination : le total reste celui de l album', '12', v_n::text, v_n = 12);
  select count(*)::integer into v_n from media_gallery_order_choices(v_grant, 3, 0);
  insert into _res values ('4', 'pagination : 3 photos par page', '3', v_n::text, v_n = 3);

  select * into r from media_gallery_order_select(v_grant, v_ids[1:8]);
  insert into _res values ('4', '8 photos pour un pack de 5 : refuse', 'trop_de_photos',
    coalesce(r.raison,'ACCEPTE'), r.raison = 'trop_de_photos');

  select * into r from media_gallery_order_select(v_grant, v_ids[1:5]);
  insert into _res values ('4', '5 photos : acceptees', 'ok / 5', r.ok||' / '||r.selectionnees, r.ok and r.selectionnees = 5);

  select count(*)::integer into v_n from media_gallery_order_choices(v_grant);
  insert into _res values ('4', 'apres le choix, l album n est plus expose', '0', v_n::text, v_n = 0);

  select * into r from media_gallery_order_select(v_grant, v_ids[6:10]);
  insert into _res values ('4', 'second choix : refuse (definitif)', 'deja_choisie',
    coalesce(r.raison,'ACCEPTE'), r.raison = 'deja_choisie');

  select photos_allowance||' / '||selection_faite||' / '||jsonb_array_length(photos) into v_txt
  from media_gallery_order_summary(v_grant);
  insert into _res values ('4', 'recapitulatif : quota, choix fait, 5 photos', '5 / true / 5', v_txt, v_txt = '5 / true / 5');

  -- ── 5. Ce que l'ecran de choix refuse de montrer ───────────────────────
  select count(*)::integer into v_n from media_gallery_order_choices('jeton-invente-au-hasard');
  insert into _res values ('5', 'jeton invente : rien', '0', v_n::text, v_n = 0);

  insert into media_orders (club_id, album_id, link_id, product_id, photos_allowance, guest_email, amount_cents, currency, status)
  values (v_club, v_album, lB, v_pack, 5, 'impaye@exemple.fr', 900, 'eur', 'pending') returning id into v_order;
  insert into media_download_grants (order_id, email) values (v_order, 'impaye@exemple.fr') returning token into v_grant;
  select count(*)::integer into v_n from media_gallery_order_choices(v_grant);
  insert into _res values ('5', 'commande NON payee : aucune photo', '0', v_n::text, v_n = 0);

  update media_orders set status = 'paid', paid_at = now() where id = v_order;
  update media_download_grants set expires_at = now() - interval '1 day' where order_id = v_order;
  select count(*)::integer into v_n from media_gallery_order_choices(v_grant);
  insert into _res values ('5', 'droit expire : aucune photo', '0', v_n::text, v_n = 0);

  -- Galerie complete : rien a choisir, tout est deja rattache.
  insert into media_orders (club_id, album_id, link_id, product_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, lA, v_complet, 'complet@exemple.fr', 1500, 'eur', 'paid', now()) returning id into v_order;
  insert into media_order_items (order_id, product_id, asset_id, album_id, unit_price_cents, quantity)
  select v_order, v_complet, id, v_album, 0, 1 from unnest(v_ids) as id;
  insert into media_download_grants (order_id, email) values (v_order, 'complet@exemple.fr') returning token into v_grant;
  select count(*)::integer into v_n from media_gallery_order_choices(v_grant);
  insert into _res values ('5', 'galerie complete : aucun choix a faire', '0', v_n::text, v_n = 0);
  select * into r from media_gallery_order_select(v_grant, v_ids[1:2]);
  insert into _res values ('5', 'galerie complete : selection sans objet', 'sans_objet',
    coalesce(r.raison,'ACCEPTE'), r.raison = 'sans_objet');

  -- ── 6. Produit desactive : le lien cesse de vendre, sans retomber sur le catalogue
  update media_products set status = 'paused' where id = v_complet;
  select * into o from media_gallery_open(sA, tA);
  insert into _res values ('6', 'produit desactive : offre configuree mais indisponible', 'true / false',
    (o.offre->>'configured')||' / '||(o.offre->>'available'),
    (o.offre->>'configured')::boolean and not (o.offre->>'available')::boolean);
  select count(*)::integer into v_n from media_gallery_products(sA, tA);
  insert into _res values ('6', 'produit desactive : aucune offre proposee', '0', v_n::text, v_n = 0);
  select * into q from media_gallery_quote(sA, tA, null);
  insert into _res values ('6', 'produit desactive : aucun devis', 'NULL',
    coalesce(q.total_cents::text,'NULL'), q.total_cents is null);
  update media_products set status = 'active' where id = v_complet;

  -- ── 7. Lien desactive ──────────────────────────────────────────────────
  update media_album_links set is_enabled = false where id = lB;
  select count(*)::integer into v_n from media_gallery_open(sB, tB) where valide;
  insert into _res values ('7', 'lien desactive : galerie fermee', '0', v_n::text, v_n = 0);
  update media_album_links set is_enabled = true where id = lB;

  insert into _ctx values (v_album, lA, lC);
end $$;

-- ── 8. Attribution par lien, lue par quelqu'un qui a le droit de voir du CA ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
do $$
declare v_txt text; v_n integer;
begin
  select orders_count||' / '||revenue_cents into v_txt
  from media_album_links_stats((select album from _ctx)) where id = (select lien_a from _ctx);
  insert into _res values ('8', 'le lien a 15 EUR porte sa vente', '1 / 1500', coalesce(v_txt,'NULL'), v_txt = '1 / 1500');

  select orders_count into v_n
  from media_album_links_stats((select album from _ctx)) where id = (select lien_c from _ctx);
  insert into _res values ('8', 'le lien historique n a rien vendu', '0', coalesce(v_n::text,'NULL'), v_n = 0);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
