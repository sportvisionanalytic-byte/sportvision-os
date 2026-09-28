-- L'aperçu avant achat : combien de photos sont RÉELLEMENT servies. Transaction annulée.
--
-- Ce test compte ce qui sort de la base, pas ce qui s'affiche : c'est tout l'objet du lot. Une
-- limite d'affichage se contourne depuis l'inspecteur du navigateur en dix secondes.
--
-- ATTENTES REALIGNEES LE 28/09/2026. Ce fichier affirmait qu'un lien SANS plafond n'en sert que 12
-- — la règle de la migration galeries-v12. Fouka l'a inversée le 07/09 au soir, et la galeries-v14
-- l'écrit : « L'APERÇU N'EST PLUS LIMITÉ PAR DÉFAUT. Sur un tournoi de 500 photos, un parent ne peut
-- pas retrouver son enfant dans 12 vignettes : il n'achèterait rien. » Le test est resté sur la v12
-- pendant trois semaines, invisible parce que le lanceur ne lisait pas les verdicts renvoyés.
--
-- CE QUI NE CHANGE PAS, et qui est la vraie valeur de ce fichier : un plafond, QUAND IL EST POSÉ, ne
-- doit pas se contourner en paginant. Cette vérification est conservée telle quelle — elle est
-- simplement appliquée à un lien qui porte un plafond (lien D, 12 photos) au lieu d'un lien qui n'en
-- porte aucun.
begin;

-- DÉCOR MANQUANT, AJOUTÉ LE 26/09/2026. Ce test tenait pour acquis un club et une équipe dont il
-- codait l'identifiant en dur. Ce club a été supprimé de la production, et le test a cessé de
-- s'exécuter sans que personne ne le voie : il levait une violation de clé étrangère, pas un ROUGE.
-- Un test qui ne s'exécute pas ne prouve rien, et 26 tests étaient dans cet état. Il crée
-- désormais son propre décor, et le `rollback` final l'efface comme le reste.
insert into clubs (id, nom) values ('8be55101-0d61-4b27-8d7b-a4761547d88b', 'ZZ Club de test')
  on conflict (id) do nothing;
insert into club_teams (id, club_id, name)
  values ('bee719f7-d735-4a0b-b070-0d20eb73e7ec', '8be55101-0d61-4b27-8d7b-a4761547d88b', 'ZZ Equipe de test')
  on conflict (id) do nothing;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_team uuid := 'bee719f7-d735-4a0b-b070-0d20eb73e7ec';
  v_saison uuid; v_album uuid; v_prod uuid;
  lA uuid; lB uuid; lC uuid; lD uuid;
  sA text; tA text; sB text; tB text; sC text; tC text; sD text; tD text;
  i integer; v_n integer; v_total bigint; v_vis integer; o record;
  v_ids uuid[] := '{}'; v_id uuid; v_premier uuid;
begin
  select id into v_saison from saisons where label = '2026-2027';
  insert into media_albums (club_id, team_id, saison_id, title, status)
  values (v_club, v_team, v_saison, 'ZZ apercu', 'published') returning id into v_album;

  -- 200 photos : un vrai album de match, pas trois photos de test.
  for i in 1..200 loop
    -- `preview_watermarked` EST NECESSAIRE DEPUIS LA v312 (27/09/2026), pas decoratif : l'apercu
    -- public ne sert que les photos dont l'apercu porte le filigrane. Sans ce drapeau, la vitrine
    -- rend 0 photo et ce test mesure le garde-fou au lieu du plafond qu'il croit mesurer.
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position, preview_watermarked)
    values (v_album, v_club, 'media/'||v_album||'/'||i||'.jpg', 'p/'||i, 't/'||i, 'P'||i||'.JPG', 'ready', i, true)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  v_premier := v_ids[1];

  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (v_club, v_saison, 'Galerie complete', 'album_complet', 3000, 'eur', 'club', 'active', '{}') returning id into v_prod;

  insert into media_album_links (album_id, slug, product_id, price_override_cents)
  values (v_album, media_gallery_unique_slug('ZZ apercu A'), v_prod, 1500)
  returning id, slug, token into lA, sA, tA;
  insert into media_album_links (album_id, slug, product_id, preview_limit)
  values (v_album, media_gallery_unique_slug('ZZ apercu B'), v_prod, 4)
  returning id, slug, token into lB, sB, tB;
  insert into media_album_links (album_id, slug, preview_limit)
  values (v_album, media_gallery_unique_slug('ZZ apercu C'), 40)
  returning id, slug, token into lC, sC, tC;

  -- Lien D : un plafond de 12, POSE explicitement. C'est sur lui que se mesure l'impossibilite de
  -- contourner un plafond, puisque le lien A n'en a plus par defaut.
  insert into media_album_links (album_id, slug, preview_limit)
  values (v_album, media_gallery_unique_slug('ZZ apercu D'), 12)
  returning id, slug, token into lD, sD, tD;

  -- ── 1. Par défaut, AUCUNE limite (décision du 07/09, galeries-v14) ─────
  select count(*)::integer into v_n from media_gallery_photos(sA, tA, null, 200, 0);
  insert into _res values ('1', 'lien sans plafond : les 200 photos sont parcourables', '200', v_n::text, v_n = 200);

  select total, visibles into v_total, v_vis from media_gallery_photos(sA, tA, null, 200, 0) limit 1;
  insert into _res values ('1', 'le vrai total reste annonce (argument de vente)', '200', v_total::text, v_total = 200);
  insert into _res values ('1', 'la page sait combien sont visibles', '200', v_vis::text, v_vis = 200);
  select apercu_limite into v_n from media_gallery_open(sA, tA);
  insert into _res values ('1', 'l ouverture n annonce aucun plafond', 'aucun',
    coalesce(v_n::text,'aucun'), coalesce(v_n, 0) = 0);

  -- ── 1bis. Un plafond POSE est respecte, et annonce ─────────────────────
  select count(*)::integer into v_n from media_gallery_photos(sD, tD, null, 200, 0);
  insert into _res values ('1bis', 'lien plafonne a 12 : 12 servies sur 200 demandees', '12', v_n::text, v_n = 12);
  select total, visibles into v_total, v_vis from media_gallery_photos(sD, tD, null, 200, 0) limit 1;
  insert into _res values ('1bis', 'le vrai total reste annonce', '200', v_total::text, v_total = 200);
  insert into _res values ('1bis', 'la page sait combien sont visibles', '12', v_vis::text, v_vis = 12);
  select apercu_limite into v_n from media_gallery_open(sD, tD);
  insert into _res values ('1bis', 'l ouverture annonce la meme limite', '12', v_n::text, v_n = 12);

  -- ── 2. UN PLAFOND NE SE CONTOURNE PAS EN PAGINANT ──────────────────────
  -- Mesure sur le lien D (plafond 12). C'est LE point du fichier : une limite d'affichage se
  -- contourne depuis l'inspecteur, une limite servie par la base ne se contourne pas.
  select count(*)::integer into v_n from media_gallery_photos(sD, tD, null, 60, 12);
  insert into _res values ('2', 'page 2 (offset 12) : rien', '0', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_gallery_photos(sD, tD, null, 60, 199);
  insert into _res values ('2', 'offset en fin d album : rien', '0', v_n::text, v_n = 0);
  select count(*)::integer into v_n from media_gallery_photos(sD, tD, null, 60, 8);
  insert into _res values ('2', 'offset 8 : seulement les 4 restantes', '4', v_n::text, v_n = 4);
  -- Une page 2 qui renverrait a nouveau les premieres photos donnerait l'illusion d'une galerie
  -- sans fin, et ferait defiler indefiniment le navigateur.
  select count(*)::integer into v_n from (
    select id from media_gallery_photos(sD, tD, null, 60, 0)
    intersect
    select id from media_gallery_photos(sD, tD, null, 60, 8)
  ) x;
  insert into _res values ('2', 'les pages ne se repetent pas', '4 communes au plus', v_n::text, v_n <= 4);

  -- ── 3. Reglable par lien ───────────────────────────────────────────────
  select count(*)::integer into v_n from media_gallery_photos(sB, tB, null, 200, 0);
  insert into _res values ('3', 'lien regle a 4 : 4 photos', '4', v_n::text, v_n = 4);
  select count(*)::integer into v_n from media_gallery_photos(sC, tC, null, 200, 0);
  insert into _res values ('3', 'lien regle a 40 : 40 photos', '40', v_n::text, v_n = 40);
  -- Deux liens vers le MEME album peuvent montrer des vitrines differentes.
  insert into _res select '3', 'deux liens, deux vitrines sur le meme album', '4 <> 40',
    (select count(*) from media_gallery_photos(sB, tB, null, 200, 0))||' <> '||
    (select count(*) from media_gallery_photos(sC, tC, null, 200, 0)),
    (select count(*) from media_gallery_photos(sB, tB, null, 200, 0)) <>
    (select count(*) from media_gallery_photos(sC, tC, null, 200, 0));

  -- ── 4. Ce sont les premieres de l album, donc choisies par le club ──────
  select id into v_id from media_gallery_photos(sA, tA, null, 200, 0) limit 1;
  insert into _res values ('4', 'la vitrine commence par la 1re photo de l album', 'oui',
    case when v_id = v_premier then 'oui' else 'non' end, v_id = v_premier);

  -- Reordonner dans l'OS change la vitrine : pas de nouvel ecran a inventer.
  update media_assets set position = 999 where id = v_premier;
  select id into v_id from media_gallery_photos(sA, tA, null, 200, 0) limit 1;
  insert into _res values ('4', 'reordonner l album change la vitrine', 'oui',
    case when v_id <> v_premier then 'oui' else 'non' end, v_id <> v_premier);
  update media_assets set position = 1 where id = v_premier;

  -- ── 5. Une photo hors vitrine n est jamais servie ──────────────────────
  -- C'est LE point du lot : le chemin de la 50e photo ne doit atteindre aucun navigateur.
  select count(*)::integer into v_n from media_gallery_photos(sD, tD, null, 200, 0) where id = v_ids[50];
  insert into _res values ('5', 'la 50e photo n est servie sur aucune page du lien plafonne', '0', v_n::text, v_n = 0);
  select count(*)::integer into v_n from (
    select id from media_gallery_photos(sD, tD, null, 200, 0)
    union select id from media_gallery_photos(sD, tD, null, 200, 12)
    union select id from media_gallery_photos(sD, tD, null, 200, 24)
    union select id from media_gallery_photos(sD, tD, null, 200, 100)
  ) x;
  insert into _res values ('5', 'toutes pages confondues : jamais plus de 12', '12', v_n::text, v_n = 12);

  -- ── 6. L achat n est pas limite par la vitrine ─────────────────────────
  -- On ne montre que 12 photos, mais on en VEND 200. Confondre les deux ferait payer 15 EUR
  -- pour douze photos.
  select count(*)::integer into v_n from unnest((select valid_asset_ids from media_gallery_quote(sA, tA, null)));
  insert into _res values ('6', 'la galerie complete vend bien les 200 photos', '200', v_n::text, v_n = 200);

  select * into o from media_gallery_open(sA, tA);
  insert into _res values ('6', 'le nombre annonce reste celui de l album', '200',
    o.photo_count::text, o.photo_count = 200);

  -- ── 7. Un lien casse ne sert rien ──────────────────────────────────────
  select count(*)::integer into v_n from media_gallery_photos(sA, 'jeton-faux', null, 200, 0);
  insert into _res values ('7', 'jeton invalide : aucune photo', '0', v_n::text, v_n = 0);
end $$;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
