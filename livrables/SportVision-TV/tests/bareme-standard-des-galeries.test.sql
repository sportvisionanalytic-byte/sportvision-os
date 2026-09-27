-- Le barème standard pose le prix d'une galerie qui n'en a pas, et ne touche jamais à celui qu'on a mis.
--
-- CE QUE ÇA RÉSOUT, mesuré le 27/09/2026 : 16 galeries publiées sur 44 n'avaient AUCUNE offre — on
-- ouvrait le lien et il n'y avait rien à acheter. Et les prix posés à la main se contredisaient : 58
-- photos à 24,90 € quand 46 photos étaient à 9,90 €.
--
-- LES QUATRE VÉRIFICATIONS, et la deuxième est celle qui protège les décisions de Fouka :
--   1. À la publication, une galerie sans offre reçoit celles de sa tranche.
--   2. Une galerie qui a DÉJÀ une offre n'est jamais réécrite — une offre posée à la main est une
--      décision, et une décision ne se corrige pas toute seule pendant la nuit.
--   3. Sous vingt photos, la galerie est gratuite : aucune offre n'est posée.
--   4. Ça marche SANS personne de connecté. Une galerie publiée par un automate doit être vendable,
--      sinon le barème ne sert qu'aux galeries créées à la main — celles qui avaient déjà un prix.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_saison uuid; v_album uuid; v_lien uuid; v_res jsonb;
  e text[] := '{}'; n int; i int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;
  insert into clubs (nom, plan) values ('ZZ Club Bareme T','performance') returning id into v_club;

  -- ══ 0. LE BARÈME LUI-MÊME, TRANCHE PAR TRANCHE ═══════════════════════════
  -- On verifie les BORNES, pas des valeurs au milieu des tranches : c'est aux bornes qu'un bareme
  -- se trompe, et 151 est justement celle que Fouka avait laissee vide.
  --
  -- ET ON COMPARE AVEC `is distinct from`, PAS AVEC `<>`. Premiere version de ce test : j'ai
  -- supprime la tranche 151-299 pour le prouver rouge, et il est reste VERT. `media_bareme_pour`
  -- rend alors NULL, et `if NULL <> 3990` vaut NULL — donc « faux », donc aucune erreur signalee.
  -- Un test qui ne voit pas une tranche MANQUANTE ne sert a rien, puisque c'est precisement le
  -- defaut qu'on redoute.
  select prix_galerie_cents into n from media_bareme_pour(19);
  if n is distinct from 0 then e := e || format('19 photos : %s cents au lieu de gratuit', n); end if;
  select prix_galerie_cents into n from media_bareme_pour(20);
  if n is distinct from 990 then e := e || format('20 photos : %s cents au lieu de 990', n); end if;
  select prix_galerie_cents into n from media_bareme_pour(150);
  if n is distinct from 2990 then e := e || format('150 photos : %s cents au lieu de 2990', n); end if;
  select prix_galerie_cents into n from media_bareme_pour(151);
  if n is distinct from 3990 then e := e || format('151 photos : %s cents au lieu de 3990 — le trou de la tranche', n); end if;
  select prix_galerie_cents into n from media_bareme_pour(299);
  if n is distinct from 3990 then e := e || format('299 photos : %s cents au lieu de 3990', n); end if;
  select prix_galerie_cents into n from media_bareme_pour(5000);
  if n is distinct from 4990 then e := e || format('5000 photos : %s cents au lieu de 4990 — la derniere tranche n est pas ouverte', n); end if;

  -- ══ 1 et 4. À LA PUBLICATION, SANS PERSONNE DE CONNECTÉ ══════════════════
  insert into media_albums (club_id, saison_id, title, status, event_date)
    values (v_club, v_saison, 'ZZ Bareme 120', 'draft', current_date) returning id into v_album;
  for i in 1..120 loop
    insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
      values (v_album, v_club,'photo','sportvision-media-prive','zz/t'||i||'.jpg','ap/t'||i||'-p.webp','ap/t'||i||'-t.webp','ready',i,true);
  end loop;
  insert into media_album_links (album_id, label, audience, is_enabled, slug, token)
    values (v_album,'ZZ L','public',true, media_gallery_unique_slug('zz-bareme-t-120'), encode(gen_random_bytes(16),'hex'))
    returning id into v_lien;
  update media_albums set status='published', published_at=now() where id=v_album;

  select count(*) into n from media_album_link_offers where link_id=v_lien;
  if n <> 2 then e := e || format('a la publication : %s offre(s) au lieu de 2', n); end if;
  select price_override_cents into n from media_album_link_offers
   where link_id=v_lien and offer_type='album_complet';
  if n is distinct from 2990 then e := e || format('galerie de 120 photos vendue %s cents au lieu de 2990', coalesce(n,-1)); end if;
  select price_override_cents, photos_allowance into n, i from media_album_link_offers
   where link_id=v_lien and offer_type='pack';
  if n is distinct from 1000 or i is distinct from 15 then e := e || format('pack : %s photos pour %s cents au lieu de 15 pour 1000', i, n); end if;

  -- ══ 2. UNE OFFRE POSÉE À LA MAIN N'EST JAMAIS RÉÉCRITE ═══════════════════
  update media_album_link_offers set price_override_cents = 4200
   where link_id=v_lien and offer_type='album_complet';
  v_res := bareme_poser_offres(v_album, null);
  select price_override_cents into n from media_album_link_offers
   where link_id=v_lien and offer_type='album_complet';
  if n is distinct from 4200 then
    e := e || format('le bareme a ECRASE un prix pose a la main : %s au lieu de 4200', n);
  end if;
  if (v_res->>'liens_sautes')::int <> 1 then
    e := e || 'le lien deja tarife n est pas signale comme saute'::text;
  end if;
  select count(*) into n from media_album_link_offers where link_id=v_lien;
  if n <> 2 then e := e || format('le rejeu a duplique les offres : %s au lieu de 2', n); end if;

  -- ══ 3. SOUS VINGT PHOTOS, RIEN À VENDRE ══════════════════════════════════
  insert into media_albums (club_id, saison_id, title, status, event_date)
    values (v_club, v_saison, 'ZZ Bareme 12', 'draft', current_date) returning id into v_album;
  for i in 1..12 loop
    insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
      values (v_album, v_club,'photo','sportvision-media-prive','zz/u'||i||'.jpg','ap/u'||i||'-p.webp','ap/u'||i||'-t.webp','ready',i,true);
  end loop;
  insert into media_album_links (album_id, label, audience, is_enabled, slug, token)
    values (v_album,'ZZ L12','public',true, media_gallery_unique_slug('zz-bareme-t-12'), encode(gen_random_bytes(16),'hex'))
    returning id into v_lien;
  update media_albums set status='published', published_at=now() where id=v_album;
  select count(*) into n from media_album_link_offers where link_id=v_lien;
  if n <> 0 then e := e || format('galerie gratuite : %s offre(s) posee(s)', n); end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : le bareme pose le prix d une galerie qui n en a pas, et ne touche jamais a celui qu on a mis';
end $$;
