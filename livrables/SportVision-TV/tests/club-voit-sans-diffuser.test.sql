-- Le club voit ses photos, il ne peut pas diffuser le lien.
--
-- Quatre vérifications, et la première est celle qui protège le chiffre d'affaires : le jeton du
-- lien ne doit plus sortir vers Club+. Sans lui le lien est inutilisable ; avec lui, il suffirait au
-- club de le transmettre aux familles pour qu'elles voient les photos sans prendre le Pass.
--
-- Le libellé du lien sort toujours, et c'est voulu : le club a le droit de savoir ce que SportVision
-- diffuse pour lui.
--
-- CE QUE CE TEST M'A APPRIS : sa première version prenait « le premier CM de la table » et
-- concluait que la fonction ne rendait rien. Le CM en question n'était affecté à aucun club. Un test
-- qui choisit mal son persona accuse le code à tort.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_album uuid; v_cm uuid; v_parent uuid; v_photo uuid;
  n int; nets int; jet text; rapport text := '';
begin
  select id into v_club from clubs where nom='RCP Fontainebleau';
  select a.id into v_album from media_albums a where a.club_id=v_club and a.status='published' limit 1;
  -- LE CM AFFECTE A CE CLUB, pas le premier de la table : ma premiere version prenait n'importe
  -- quel CM et concluait a tort que la fonction ne rendait rien.
  select pr.id into v_cm from profiles pr
   where pr.actif and pr.role in ('cm','admin')
     and v_club in (select c from cm_clubs_autorises() c)
   limit 1;
  if v_cm is null then
    -- Repli : un compte qui passe la porte d'entree de media_club_galleries.
    select pr.id into v_cm from profiles pr where pr.actif and pr.role='admin' limit 1;
  end if;
  select pp.user_id into v_parent from player_profiles pp where pp.club_id=v_club and pp.user_id is not null limit 1;

  -- 1. Le jeton ne sort plus.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cm::text)::text, true);
  select (g.liens->0->>'token') into jet from media_club_galleries(v_club) g where g.album_id=v_album;
  rapport := rapport || format(E'\n  jeton rendu au club : %s (attendu vide)', coalesce(jet,'(aucun)'));
  select (g.liens->0->>'label') into jet from media_club_galleries(v_club) g where g.album_id=v_album;
  rapport := rapport || format(E'\n  libelle du lien     : %s (le club sait quels liens existent)', coalesce(jet,'(aucun)'));

  -- 2. Le CM voit les photos, nettes, sans jeton.
  select count(*), count(preview_clair_path) into n, nets from media_club_gallery_photos(v_album);
  rapport := rapport || format(E'\n  CM  -> %s photos, %s nettes', n, nets);

  -- 3. Une famille ne doit RIEN obtenir de cette fonction : elle ne parcourt pas les galeries.
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text)::text, true);
  select count(*) into n from media_club_gallery_photos(v_album);
  rapport := rapport || format(E'\n  famille -> %s photos (attendu 0)', n);

  -- 4. Ni un visiteur non connecte.
  perform set_config('request.jwt.claims', '{}', true);
  select count(*) into n from media_club_gallery_photos(v_album);
  rapport := rapport || format(E'\n  anonyme -> %s photos (attendu 0)', n);

  raise exception 'RAPPORT%', rapport;
end $$;
