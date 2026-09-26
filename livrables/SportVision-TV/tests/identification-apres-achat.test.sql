-- « Oui c'est bien moi » : la dernière marche, et la brèche qu'elle refermait.
--
-- Trois vérifications. La PREMIÈRE est celle qui protège le chiffre d'affaires :
-- media_galerie_a_identifier rendait TOUTES les photos d'une galerie à n'importe quelle famille de
-- l'enfant, sans rien exiger. Elle contournait donc le plafond de quatre photos de la v282 — il
-- suffisait de l'appeler pour parcourir les 110 photos filigranées sans avoir pris le Pass. Personne
-- ne l'appelait (vérifié dans les quatre interfaces), donc personne n'en a profité, mais la porte
-- était ouverte.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_album uuid; v_prod uuid; v_admin uuid;
  v_joueur uuid; v_user uuid; v_order uuid; n int; rapport text := '';
begin
  select id into v_club from clubs where nom='RCP Fontainebleau';
  select a.id into v_album from media_albums a
   where a.club_id=v_club and a.status='published' order by a.published_at desc limit 1;
  select id into v_prod from media_products where club_id=v_club and type='pass_saison';
  select id into v_admin from profiles where role='admin' and actif limit 1;
  select pp.id, pp.user_id into v_joueur, v_user from player_profiles pp
   where pp.club_id=v_club and pp.user_id is not null limit 1;

  -- 1. SANS Pass : la fonction ne doit RIEN rendre. C'est la breche fermee.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  select count(*) into n from media_galerie_a_identifier(v_album, v_joueur);
  rapport := rapport || format(E'\n  famille SANS Pass -> %s photos (attendu 0, c''est la breche fermee)', n);

  -- 2. AVEC le Pass : elle rend la galerie, pour s'identifier.
  insert into media_orders (club_id, product_id, purchased_by_user_id, beneficiary_person_id,
                            amount_cents, currency, status, shipping_status, source, encaisse_par)
  values (v_club, v_prod, v_user, v_joueur, 3990, 'eur', 'pending', 'non_requis', 'especes', v_admin)
  returning id into v_order;
  perform media_activer_commande(v_order);

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  select count(*) into n from media_galerie_a_identifier(v_album, v_joueur);
  rapport := rapport || format(E'\n  famille AVEC Pass -> %s photos', n);
  select count(preview_clair_path) into n from media_galerie_a_identifier(v_album, v_joueur);
  rapport := rapport || format(E'\n    dont %s avec un apercu net', n);

  -- 3. Une autre famille ne doit pas pouvoir interroger cet enfant.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select user_id from player_profiles where id<>v_joueur and user_id is not null limit 1)::text)::text, true);
  begin
    perform * from media_galerie_a_identifier(v_album, v_joueur);
    rapport := rapport || E'\n  une autre famille -> PASSE (FAILLE)';
  exception when others then
    rapport := rapport || format(E'\n  une autre famille -> refuse (%s)', sqlerrm);
  end;

  raise exception 'RAPPORT%', rapport;
end $$;
