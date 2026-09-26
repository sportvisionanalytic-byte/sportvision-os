-- Les douze fonctions media, chacune appelée par le persona qui l'appelle vraiment.
--
-- Écrit le 26/09/2026 après une journée où huit d'entre elles ont été réécrites (v280 à v288 :
-- multi-catégories, filigrane selon qui regarde, plafond du non-payeur, jeton retiré à Club+,
-- identification après achat, couverture de galerie). Une seule erreur de signature ou de droit et
-- un écran entier se vide sans rien dire.
--
-- CE QUE CE TEST M'A APPRIS EN L'ÉCRIVANT : appeler `media_galerie_a_identifier` et
-- `media_pass_disponible` en tant qu'admin lève « Ce joueur n'est pas rattaché à votre compte ».
-- Ce n'est PAS une régression : ces deux-là n'ont jamais été ouvertes au staff, qui marque les
-- photos par media_joueurs_de_galerie. Un test qui choisit mal son persona accuse le code à tort —
-- c'est la troisième fois de la journée, d'où la séparation explicite ci-dessous.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_admin uuid; v_club uuid; v_equipe uuid; v_album uuid; v_joueur uuid; v_user uuid; v_prod uuid;
  n int; rapport text := ''; ok boolean;
  procedure_staff text;
begin
  select id into v_admin from profiles where role='admin' and actif limit 1;
  select id into v_club from clubs where nom='RCP Fontainebleau';
  select id into v_equipe from club_teams where club_id=v_club and name='U16A';
  select a.id into v_album from media_albums a where a.club_id=v_club and a.status='published' limit 1;
  select pp.id, pp.user_id into v_joueur, v_user from player_profiles pp
   where pp.club_id=v_club and pp.user_id is not null limit 1;
  select id into v_prod from media_products where club_id=v_club limit 1;

  -- ── Ce que le STAFF appelle ──────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  select count(*) into n from media_album_list(v_club, v_equipe, null);
  rapport := rapport || format(E'\n  [staff]   media_album_list            %s', n);
  select count(*) into n from media_club_galleries(v_club);
  rapport := rapport || format(E'\n  [staff]   media_club_galleries        %s', n);
  select count(*) into n from media_club_gallery_photos(v_album);
  rapport := rapport || format(E'\n  [staff]   media_club_gallery_photos   %s', n);
  select count(*) into n from media_album_assets(v_album, 500, 0, true);
  rapport := rapport || format(E'\n  [staff]   media_album_assets          %s', n);
  select count(*) into n from galerie_rattachements(v_club, 60, null);
  rapport := rapport || format(E'\n  [staff]   galerie_rattachements       %s', n);
  select media_voit_sans_filigrane(v_album) into ok;
  rapport := rapport || format(E'\n  [staff]   media_voit_sans_filigrane   %s', ok);
  select count(*) into n from media_joueurs_pour_acces(v_club, v_prod, null);
  rapport := rapport || format(E'\n  [staff]   media_joueurs_pour_acces    %s', n);

  -- ── Ce que la FAMILLE appelle ────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  select count(*) into n from media_photos_du_joueur(v_album, v_joueur);
  rapport := rapport || format(E'\n  [famille] media_photos_du_joueur      %s', n);
  select count(*) into n from media_photos_pour_famille(v_album, v_joueur);
  rapport := rapport || format(E'\n  [famille] media_photos_pour_famille   %s', n);
  select count(*) into n from media_galerie_a_identifier(v_album, v_joueur);
  rapport := rapport || format(E'\n  [famille] media_galerie_a_identifier  %s (0 attendu sans Pass)', n);
  select count(*) into n from media_etat_reconnaissance(v_joueur);
  rapport := rapport || format(E'\n  [famille] media_etat_reconnaissance   %s', n);
  select count(*) into n from media_pass_disponible(v_club, v_joueur);
  rapport := rapport || format(E'\n  [famille] media_pass_disponible       %s', n);
  select count(*) into n from media_album_list(v_club, v_equipe, null);
  rapport := rapport || format(E'\n  [famille] media_album_list            %s', n);

  raise exception 'LES DOUZE REPONDENT%', rapport;
end $$;
