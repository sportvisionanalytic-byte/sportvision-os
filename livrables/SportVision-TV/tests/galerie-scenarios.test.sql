-- Les quatre situations reelles du cahier des charges (§31 a §34), plus les tarifs multiples.
--
-- Le principe a verifier est toujours le meme : Club+, Connect, les equipes et les saisons
-- ENRICHISSENT une galerie, ils ne doivent jamais etre necessaires pour vendre.
--
-- Tout s'execute dans une transaction annulee : aucune donnee n'est laissee.

begin;

do $$
declare
  v_club uuid; v_saison uuid; v_equipe uuid;
  v_album uuid; v_photo uuid; v_lien uuid; v_lien2 uuid;
  v_offre uuid; v_offre2 uuid; v_slug text; v_token text; v_slug2 text; v_token2 text;
  v_n integer; v_prix integer; v_ok boolean; v_raison text;
  e text[] := '{}';

begin
  select id into v_club from clubs limit 1;
  select id into v_saison from saisons order by label desc limit 1;
  select id into v_equipe from club_teams where club_id = v_club limit 1;

  -- ═══ §32 — Galerie rattachee a un club SportVision, avec Club+ ═══════════
  insert into media_albums (title, club_id, team_id, saison_id, status, photo_count)
  values ('Villeneuve vs Sens — U18', v_club, v_equipe, v_saison, 'published', 0)
  returning id into v_album;
  insert into media_assets (album_id, original_path, status, original_filename)
  values (v_album, 'm/a.jpg', 'ready', 'a.jpg') returning id into v_photo;
  insert into media_album_links (album_id, slug, label, is_enabled, visible_in_clubplus)
  values (v_album, media_gallery_unique_slug('villeneuve-sens'), 'Parents du club', true, true)
  returning id, slug, token into v_lien, v_slug, v_token;
  insert into media_album_link_offers (link_id, offer_type, label, photos_allowance, price_override_cents, display_order, is_enabled)
  values (v_lien, 'album_complet', 'Toutes les photos', null, 3000, 1, true) returning id into v_offre;

  select valide into v_ok from media_gallery_open(v_slug, v_token, null);
  if not coalesce(v_ok,false) then e := e || 'S32 : la galerie club ne s ouvre pas'::text; end if;

  select total_cents into v_prix from media_gallery_quote(v_slug, v_token, null, null, v_offre);
  if coalesce(v_prix,-1) <> 3000 then e := e || ('S32 : devis = '||coalesce(v_prix,-1)); end if;

  -- La photo doit avoir herite du club, pour Club+ et les statistiques par club.
  perform 1 from media_assets where id = v_photo and club_id = v_club;
  if not found then e := e || 'S32 : la photo n a pas herite du club'::text; end if;

  -- ═══ §31 — Club externe, aucun club SportVision ══════════════════════════
  insert into media_albums (title, structure_externe, status, photo_count)
  values ('Tournoi U12 — Sens', 'FC Sens U12', 'published', 0) returning id into v_album;
  insert into media_assets (album_id, original_path, status, original_filename)
  values (v_album, 'm/b.jpg', 'ready', 'b.jpg') returning id into v_photo;
  insert into media_album_links (album_id, slug, label, is_enabled)
  values (v_album, media_gallery_unique_slug('tournoi-u12'), 'Lien principal', true)
  returning id, slug, token into v_lien, v_slug, v_token;
  insert into media_album_link_offers (link_id, offer_type, label, photos_allowance, price_override_cents, display_order, is_enabled)
  values (v_lien, 'pack', '15 photos', 15, 1000, 1, true) returning id into v_offre;

  select valide into v_ok from media_gallery_open(v_slug, v_token, null);
  if not coalesce(v_ok,false) then e := e || 'S31 : la galerie externe ne s ouvre pas'::text; end if;
  select total_cents into v_prix from media_gallery_quote(v_slug, v_token, array[v_photo], null, v_offre);
  if coalesce(v_prix,-1) <> 1000 then e := e || ('S31 : devis = '||coalesce(v_prix,-1)); end if;
  perform 1 from media_assets where id = v_photo and club_id is null;
  if not found then e := e || 'S31 : la photo a recu un club qui n existe pas'::text; end if;
  -- Aucune organisation, aucun club n a ete cree au passage.
  perform 1 from clubs where nom = 'FC Sens U12';
  if found then e := e || 'S31 : un club a ete cree a partir de la structure externe'::text; end if;

  -- ═══ §33 — Joueur individuel, aucun club, aucune equipe ══════════════════
  insert into media_albums (title, status, photo_count)
  values ('Shooting individuel — Lucas', 'published', 0) returning id into v_album;
  insert into media_assets (album_id, original_path, status, original_filename)
  values (v_album, 'm/c.jpg', 'ready', 'c.jpg') returning id into v_photo;
  insert into media_album_links (album_id, slug, label, is_enabled)
  values (v_album, media_gallery_unique_slug('shooting-lucas'), 'Lien principal', true)
  returning id, slug, token into v_lien, v_slug, v_token;
  insert into media_album_link_offers (link_id, offer_type, label, price_override_cents, display_order, is_enabled)
  values (v_lien, 'album_complet', 'Toutes les photos', 2500, 1, true) returning id into v_offre;
  select total_cents into v_prix from media_gallery_quote(v_slug, v_token, null, null, v_offre);
  if coalesce(v_prix,-1) <> 2500 then e := e || ('S33 : devis = '||coalesce(v_prix,-1)); end if;

  -- ═══ §34 — Evenement multi-equipes, aucune equipe unique ═════════════════
  insert into media_albums (title, structure_externe, club_id, saison_id, status, photo_count)
  values ('Finale tournoi U13', 'Plusieurs clubs', v_club, v_saison, 'published', 0) returning id into v_album;
  insert into media_assets (album_id, original_path, status, original_filename)
  values (v_album, 'm/d.jpg', 'ready', 'd.jpg') returning id into v_photo;
  insert into media_album_links (album_id, slug, label, is_enabled)
  values (v_album, media_gallery_unique_slug('finale-u13'), 'Lien principal', true)
  returning id, slug, token into v_lien, v_slug, v_token;
  insert into media_album_link_offers (link_id, offer_type, label, photos_allowance, price_override_cents, display_order, is_enabled)
  values (v_lien, 'pack', '10 photos', 10, 800, 1, true) returning id into v_offre;
  select total_cents into v_prix from media_gallery_quote(v_slug, v_token, array[v_photo], null, v_offre);
  if coalesce(v_prix,-1) <> 800 then e := e || ('S34 : devis multi-equipes = '||coalesce(v_prix,-1)); end if;
  perform 1 from media_albums where id = v_album and team_id is null;
  if not found then e := e || 'S34 : une equipe unique a ete imposee'::text; end if;

  -- ═══ Plusieurs tarifs sur LA MEME galerie, sans dupliquer les photos ═════
  insert into media_album_links (album_id, slug, label, is_enabled)
  values (v_album, media_gallery_unique_slug('finale-u13-adverse'), 'Équipe adverse', true)
  returning id, slug, token into v_lien2, v_slug2, v_token2;
  insert into media_album_link_offers (link_id, offer_type, label, photos_allowance, price_override_cents, display_order, is_enabled)
  values (v_lien2, 'pack', '10 photos', 10, 1500, 1, true) returning id into v_offre2;

  select total_cents into v_prix from media_gallery_quote(v_slug2, v_token2, array[v_photo], null, v_offre2);
  if coalesce(v_prix,-1) <> 1500 then e := e || ('Multi-tarifs : second lien = '||coalesce(v_prix,-1)||' au lieu de 1500'); end if;
  select count(*)::integer into v_n from media_assets where album_id = v_album;
  if v_n <> 1 then e := e || ('Multi-tarifs : les photos ont ete dupliquees ('||v_n||')'); end if;

  -- L'offre d'un lien ne doit JAMAIS etre achetable depuis l'autre lien.
  select count(*)::integer into v_n
  from media_gallery_quote(v_slug, v_token, array[v_photo], null, v_offre2);
  if v_n <> 0 then e := e || 'Multi-tarifs : l offre du voisin est achetable au mauvais tarif'::text; end if;

  -- ═══ §14 — Archivee : plus de nouvelles ventes ═══════════════════════════
  update media_albums set status = 'archived' where id = v_album;
  select raison into v_raison from _media_gallery_resolve(v_slug, v_token, null);
  if coalesce(v_raison,'') <> 'non_publie' then
    e := e || ('Archivee : raison = '||coalesce(v_raison,'(aucune)')||', la vente devrait etre fermee');
  end if;
  select count(*)::integer into v_n from media_gallery_quote(v_slug, v_token, array[v_photo], null, v_offre);
  if v_n <> 0 then e := e || 'Archivee : un devis est encore possible'::text; end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — club SportVision + Club+, club externe, aucun club, joueur seul, evenement multi-equipes, tarifs multiples sur une meme galerie, et archivage qui ferme la vente.' as verdict;

rollback;
