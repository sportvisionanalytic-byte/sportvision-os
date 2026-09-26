-- Le non-payeur voit un APERÇU, pas la galerie : 4 photos marquées, et le vrai total annoncé.
--
-- Trois cas, et le premier est celui qui protège le chiffre d'affaires : une famille sans Pass
-- reçoit 4 lignes au plus, AUCUN chemin d'aperçu clair, mais le total réel — sans quoi l'écran
-- dirait « 0 autre photo » et laisserait croire qu'il n'y en a pas plus.
--
-- Le plafond est appliqué EN BASE. Une limite posée dans l'application se contourne en rejouant
-- la requête, et ces photos se vendent.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_u16 uuid; v_saison uuid; v_album uuid; v_prod uuid;
  v_admin uuid; v_parent uuid; v_joueur uuid; v_order uuid; v_asset uuid;
  n int; tot int; clairs int; rapport text := ''; i int;
begin
  select id into v_club from clubs where nom='RCP Fontainebleau';
  select id into v_u16 from club_teams where club_id=v_club and name='U16A';
  select id into v_saison from saisons where current_date between date_debut and date_fin limit 1;
  select id into v_prod from media_products where club_id=v_club and type='pass_saison';
  select id into v_admin from profiles where role='admin' and actif limit 1;
  select pp.id, pp.user_id into v_joueur, v_parent from player_profiles pp
   where pp.club_id=v_club and pp.user_id is not null limit 1;

  insert into media_albums (title, club_id, team_id, saison_id, status, access_mode, published_at)
  values ('TEST apercu limite', v_club, v_u16, v_saison, 'published', 'free_members', now())
  returning id into v_album;

  -- 10 photos marquees sur ce joueur, chacune avec un apercu clair fabrique.
  for i in 1..10 loop
    insert into media_assets (album_id, club_id, kind, status, position, original_path,
                              preview_path, thumb_path, preview_clair_path)
    values (v_album, v_club, 'photo', 'ready', i, 'media/'||v_album||'/a'||i||'.jpg',
            v_album||'/a'||i||'-p.webp', v_album||'/a'||i||'-t.webp',
            'apercus-clairs/'||v_album||'/a'||i||'-pc.webp')
    returning id into v_asset;
    insert into media_player_tags (media_ref_type, media_ref_id, player_id, statut, source)
    values ('media_asset', v_asset, v_joueur, 'valide', 'humain');
  end loop;

  -- 1. La famille SANS Pass : 4 lignes au plus, aucun chemin clair, mais le total vrai.
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text)::text, true);
  select count(*), max(total), count(preview_clair_path)
    into n, tot, clairs from media_photos_du_joueur(v_album, v_joueur);
  rapport := rapport || format(E'\n  SANS Pass  -> %s ligne(s), total annonce %s, chemins clairs %s (attendu 4 / 10 / 0)', n, tot, clairs);

  -- 2. Le staff : tout, et en clair.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  select count(*), max(total), count(preview_clair_path)
    into n, tot, clairs from media_photos_du_joueur(v_album, v_joueur);
  rapport := rapport || format(E'\n  staff      -> %s ligne(s), total %s, chemins clairs %s (attendu 10 / 10 / 10)', n, tot, clairs);

  -- 3. La meme famille APRES avoir paye.
  insert into media_orders (club_id, product_id, purchased_by_user_id, beneficiary_person_id,
                            amount_cents, currency, status, shipping_status, source, encaisse_par)
  values (v_club, v_prod, v_parent, v_joueur, 3990, 'eur', 'pending', 'non_requis', 'especes', v_admin)
  returning id into v_order;
  perform media_activer_commande(v_order);

  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text)::text, true);
  select count(*), max(total), count(preview_clair_path)
    into n, tot, clairs from media_photos_du_joueur(v_album, v_joueur);
  rapport := rapport || format(E'\n  AVEC Pass  -> %s ligne(s), total %s, chemins clairs %s (attendu 10 / 10 / 10)', n, tot, clairs);

  raise exception 'RAPPORT%', rapport;
end $$;
