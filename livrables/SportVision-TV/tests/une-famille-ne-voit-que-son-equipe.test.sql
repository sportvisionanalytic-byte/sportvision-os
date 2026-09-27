-- Une famille ne voit que les galeries de l'équipe de son enfant, ni la liste ni le contenu.
--
-- CE QUI A RENDU CE TEST NÉCESSAIRE (27/09/2026). Fouka, en ouvrant l'application : « tout le monde
-- voit les galeries de tout le monde. Alors que normalement, les joueurs doivent voir uniquement leur
-- propre galerie à eux. » C'est une régression que J'AI introduite la veille : en rattachant 23
-- galeries à leur club sans équipe (v296), je les ai toutes fait tomber dans la branche « galerie de
-- club » de `media_album_list`, visible par tout le monde. Des photos d'enfants se sont affichées à
-- des familles qui n'y ont rien à voir.
--
-- ET FERMER LA LISTE NE SUFFISAIT PAS. Mesure avant la v304 : une famille de U18 R3 obtenait QUATRE
-- PHOTOS d'une galerie U10 en passant simplement son identifiant, par l'aperçu de repli de la v299.
-- Une liste filtrée n'est pas un contrôle d'accès. Ce test vérifie donc les DEUX : ce que la liste
-- rend, et ce que le contenu rend quand on nomme une galerie directement.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_saison uuid; v_eqA uuid; v_eqB uuid;
  v_album_A uuid; v_album_B uuid; v_album_sans uuid;
  v_user uuid; v_joueur uuid; v_coach uuid;
  e text[] := '{}'; n int; i int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;

  -- Le plan par defaut d'un club plafonne a UNE equipe (check_club_teams_limit) : le decor en a
  -- besoin de deux pour mesurer un cloisonnement.
  insert into clubs (nom, plan) values ('ZZ Club Cloison', 'performance') returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ Cloison U13') returning id into v_eqA;
  insert into club_teams (club_id, name) values (v_club,'ZZ Cloison U15') returning id into v_eqB;

  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_eqA, v_saison, 'ZZ Galerie U13', 'published', current_date, now()) returning id into v_album_A;
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_eqB, v_saison, 'ZZ Galerie U15', 'published', current_date, now()) returning id into v_album_B;
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, null, v_saison, 'ZZ Galerie sans equipe', 'published', current_date, now()) returning id into v_album_sans;
  for i in 1..5 loop
    insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position)
      values (v_album_A, v_club,'photo','sportvision-media-prive','zz/a'||i||'.jpg','ap/a'||i||'.webp','ready',i);
    insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position)
      values (v_album_B, v_club,'photo','sportvision-media-prive','zz/b'||i||'.jpg','ap/b'||i||'.webp','ready',i);
    insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position)
      values (v_album_sans, v_club,'photo','sportvision-media-prive','zz/s'||i||'.jpg','ap/s'||i||'.webp','ready',i);
  end loop;

  -- La famille d'un enfant de l'equipe A.
  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-cloison-famille@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, v_user,'ZZ','CloisonA','2013-03-03','actif') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur, v_eqA, v_club,'2026-2027','active');

  -- Un coach de l'equipe B, pour la regle v155 par les DEUX chemins.
  v_coach := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-cloison-coach@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status, teams)
    values (v_club, v_coach, 'coach', 'actif', to_jsonb(array['ZZ Cloison U15']));

  -- ══ 1. LA LISTE : SON EQUIPE, ET RIEN D'AUTRE ════════════════════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_user::text,'role','authenticated')::text, true);
  select count(*) into n from media_album_list(v_club, v_eqA, v_saison);
  if n <> 1 then e := e || format('la famille voit %s galerie(s) au lieu de 1', n); end if;
  select count(*) into n from media_album_list(v_club, v_eqA, v_saison) where id = v_album_B;
  if n <> 0 then e := e || 'la galerie de l AUTRE equipe apparait dans la liste'::text; end if;
  select count(*) into n from media_album_list(v_club, v_eqA, v_saison) where id = v_album_sans;
  if n <> 0 then e := e || 'la galerie SANS equipe apparait dans la liste d une famille'::text; end if;

  -- ══ 2. LE CONTENU : NOMMER UNE GALERIE NE L'OUVRE PAS ════════════════════
  --
  -- C'est la moitie du test qui manquait, et c'est celle qui fuyait.
  select count(*) into n from media_photos_du_joueur(v_album_B, v_joueur);
  if n <> 0 then e := e || format('%s photo(s) de l AUTRE equipe servies en nommant sa galerie', n); end if;
  select count(*) into n from media_photos_du_joueur(v_album_sans, v_joueur);
  if n <> 0 then e := e || format('%s photo(s) d une galerie SANS equipe servies a une famille', n); end if;
  select count(*) into n from media_galerie_a_identifier(v_album_sans, v_joueur);
  if n <> 0 then e := e || 'l identification passe sur une galerie sans equipe'::text; end if;

  -- ══ 3. ET CE QUI DOIT MARCHER MARCHE ═════════════════════════════════════
  select count(*) into n from media_photos_du_joueur(v_album_A, v_joueur);
  if n <> 4 then e := e || format('sur la galerie de SON equipe : %s photo(s) au lieu de 4 (apercu v299)', n); end if;

  -- ══ 4. LE COACH : MEME REPONSE PAR LES DEUX CHEMINS (v303) ═══════════════
  --
  -- Club+ lui montrait 5 galeries et media_album_list 23 : deux portes sur la meme piece, une seule
  -- fermee.
  perform set_config('request.jwt.claims', json_build_object('sub',v_coach::text,'role','authenticated')::text, true);
  select count(*) into n from media_album_list(v_club, null, v_saison);
  if n <> 2 then
    e := e || format('le coach de U15 voit %s galerie(s) par media_album_list au lieu de 2 (la sienne + celle sans equipe)', n);
  end if;
  select count(*) into i from media_club_galleries(v_club);
  if i <> n then
    e := e || format('les deux chemins ne s accordent pas pour le coach : media_album_list=%s, media_club_galleries=%s', n, i);
  end if;
  select count(*) into n from media_album_list(v_club, null, v_saison) where id = v_album_A;
  if n <> 0 then e := e || 'le coach de U15 voit la galerie des U13'::text; end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : la famille ne voit que son equipe, liste ET contenu ; le coach a la meme reponse par les deux chemins';
end $$;
