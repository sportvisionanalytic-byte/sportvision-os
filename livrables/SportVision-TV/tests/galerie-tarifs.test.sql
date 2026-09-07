begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_team uuid := 'bee719f7-d735-4a0b-b070-0d20eb73e7ec';
  v_saison uuid;
  v_album uuid;
  b record;
  i integer;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  select id into v_saison from saisons where label = '2026-2027';

  insert into media_albums (club_id, team_id, saison_id, title, status)
  values (v_club, v_team, v_saison, 'ZZ tarifs', 'published') returning id into v_album;

  for i in 1..20 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, status, position)
    values (v_album, v_club, 'media/'||v_album||'/'||i||'.jpg', 'p/'||i, 't/'||i, 'ready', i)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata) values
   (v_club, v_saison, 'Photo a l unite', 'photo_unite', 400, 'eur', 'club', 'active', '{}'),
   (v_club, v_saison, 'Pack 5 photos',   'pack',       1500, 'eur', 'club', 'active', '{"photo_count":5}'),
   (v_club, v_saison, 'Pack 10 photos',  'pack',       2500, 'eur', 'club', 'active', '{"photo_count":10}'),
   (v_club, v_saison, 'Galerie complete','album_complet',2900,'eur','club', 'active', '{}');

  -- ── Memes scenarios que les tests du moteur TypeScript, chiffre pour chiffre ──
  for i in 1..3 loop
    select * into b from _media_gallery_best_price(v_album, i);
    insert into _res values (i::text, i||' photo(s) : tarif unitaire', (i*400)::text, b.total_cents::text, b.total_cents = i*400);
  end loop;

  select * into b from _media_gallery_best_price(v_album, 4);
  insert into _res values ('4', '4 photos : bascule sur le pack 5 (15 EUR < 16 EUR)', '1500 / baseline 1600',
    b.total_cents||' / baseline '||b.baseline_cents, b.total_cents = 1500 and b.baseline_cents = 1600);
  insert into _res values ('4', '4 photos : une seule ligne, le pack', 'Pack 5 photos x1',
    (b.lines->0->>'name')||' x'||(b.lines->0->>'quantity'),
    (b.lines->0->>'name') = 'Pack 5 photos' and (b.lines->0->>'quantity') = '1');

  select * into b from _media_gallery_best_price(v_album, 7);
  insert into _res values ('7', '7 photos : pack 5 + 2 unites (23 EUR)', '2300', b.total_cents::text, b.total_cents = 2300);
  insert into _res values ('7', '7 photos : 2 lignes', '2', jsonb_array_length(b.lines)::text, jsonb_array_length(b.lines) = 2);

  select * into b from _media_gallery_best_price(v_album, 9);
  insert into _res values ('9', '9 photos : le pack 10 deborde et coute moins cher', '2500 / Pack 10 photos',
    b.total_cents||' / '||(b.lines->0->>'name'), b.total_cents = 2500 and (b.lines->0->>'name') = 'Pack 10 photos');

  select * into b from _media_gallery_best_price(v_album, 12);
  insert into _res values ('12', '12 photos : la galerie complete devient optimale', '2900 / album=true / couvre 20',
    b.total_cents||' / album='||b.whole_album||' / couvre '||(b.lines->0->>'covers_photos'),
    b.total_cents = 2900 and b.whole_album and (b.lines->0->>'covers_photos') = '20');

  -- Sans album complet : la combinaison de packs reste optimale.
  update media_products set status = 'paused' where club_id = v_club and type = 'album_complet';
  select * into b from _media_gallery_best_price(v_album, 12);
  insert into _res values ('12b', 'sans album complet : pack 10 + 2 unites (33 EUR)', '3300 / album=false',
    b.total_cents||' / album='||b.whole_album, b.total_cents = 3300 and not b.whole_album);

  -- Galerie vendue uniquement en album complet : aucune reference unitaire, donc aucune economie annoncee.
  update media_products set status = 'paused' where club_id = v_club and type in ('photo_unite','pack');
  update media_products set status = 'active' where club_id = v_club and type = 'album_complet';
  select * into b from _media_gallery_best_price(v_album, 3);
  insert into _res values ('album seul', 'album complet seul : pas de baseline inventee', '2900 / baseline NULL',
    b.total_cents||' / baseline '||coalesce(b.baseline_cents::text,'NULL'),
    b.total_cents = 2900 and b.baseline_cents is null);

  -- Pack sans taille configuree : jamais applique au hasard.
  update media_products set status = 'paused' where club_id = v_club;
  update media_products set status = 'active' where club_id = v_club and type = 'photo_unite';
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Pack mystere', 'pack', 100, 'eur', 'club', 'active', '{}');
  select * into b from _media_gallery_best_price(v_album, 5);
  insert into _res values ('pack casse', 'pack sans taille : ignore, pas applique a 1 EUR', '2000', b.total_cents::text, b.total_cents = 2000);

  -- A prix egal, on garde le plus petit produit.
  update media_products set status = 'paused' where club_id = v_club and name = 'Pack mystere';
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Pack 3 au meme prix', 'pack', 1200, 'eur', 'club', 'active', '{"photo_count":3}');
  select * into b from _media_gallery_best_price(v_album, 3);
  insert into _res values ('prix egal', 'a prix egal : 3 photos plutot qu un pack', '1200 / Photo a l unite',
    b.total_cents||' / '||(b.lines->0->>'name'),
    b.total_cents = 1200 and (b.lines->0->>'name') = 'Photo a l unite');

  -- ── Devis ferme : seules les photos reellement dans l album comptent ──
  update media_products set status = 'paused' where club_id = v_club;
  update media_products set status = 'active' where club_id = v_club and type in ('photo_unite','pack') and name in ('Photo a l unite','Pack 5 photos');
  insert into _res
  select 'devis', 'devis ferme : 4 photos valides = 15 EUR', '4 / 1500',
         coalesce(array_length(q.valid_asset_ids,1),0)||' / '||q.total_cents,
         array_length(q.valid_asset_ids,1) = 4 and q.total_cents = 1500
  from media_gallery_quote(
    (select slug from media_album_links where album_id = v_album),
    (select token from media_album_links where album_id = v_album),
    v_ids[1:4]) q;
end $$;

-- Le lien public est cree apres coup pour tester le devis ferme de bout en bout.
do $$
declare v_album uuid; v_slug text; v_token text; q record;
begin
  select id into v_album from media_albums where title = 'ZZ tarifs';
  insert into media_album_links (album_id, slug) values (v_album, media_gallery_unique_slug('ZZ tarifs'))
  returning slug, token into v_slug, v_token;

  select * into q from media_gallery_quote(v_slug, v_token,
    (select array_agg(id) from (select id from media_assets where album_id = v_album order by position limit 4) s));
  insert into _res values ('devis', 'devis ferme : 4 photos = 15 EUR', '4 photos / 1500',
    coalesce(array_length(q.valid_asset_ids,1),0)||' photos / '||coalesce(q.total_cents::text,'NULL'),
    array_length(q.valid_asset_ids,1) = 4 and q.total_cents = 1500);

  -- Une photo qui n'appartient pas a l'album ne doit jamais entrer dans le devis.
  select * into q from media_gallery_quote(v_slug, v_token,
    (select array_agg(id) from (select id from media_assets where album_id = v_album order by position limit 2) s)
    || array['00000000-0000-0000-0000-000000000123'::uuid]);
  insert into _res values ('devis', 'photo etrangere a l album : ignoree', '2 photos / 800',
    coalesce(array_length(q.valid_asset_ids,1),0)||' photos / '||coalesce(q.total_cents::text,'NULL'),
    array_length(q.valid_asset_ids,1) = 2 and q.total_cents = 800);

  -- Mauvais jeton : aucun devis, donc aucun paiement possible.
  select * into q from media_gallery_quote(v_slug, 'faux-jeton',
    (select array_agg(id) from (select id from media_assets where album_id = v_album limit 2) s));
  insert into _res values ('devis', 'mauvais jeton : aucun devis', 'NULL', coalesce(q.total_cents::text,'NULL'), q.total_cents is null);

  -- Grille tarifaire : une ligne par nombre de photos possible.
  insert into _res select 'grille', 'grille tarifaire : 20 lignes', '20', count(*)::text, count(*) = 20
  from media_gallery_price_ladder(v_slug, v_token);
end $$;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
