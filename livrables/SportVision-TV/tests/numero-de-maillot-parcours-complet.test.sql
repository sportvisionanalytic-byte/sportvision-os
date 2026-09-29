-- « À ce match-là, j'étais le numéro 7 » : la chaîne entière, des deux côtés (28/09/2026).
--
-- LE TRAVAIL EST PARTAGÉ, ET C'EST TOUT L'INTÉRÊT. Dans l'OS, quelqu'un relève les numéros LISIBLES
-- sur une photo, sans savoir à qui ils appartiennent — taper « 7 11 » va bien plus vite que choisir
-- deux noms dans une liste de vingt. Dans l'application, la famille déclare « j'étais le 7 à ce
-- match ». La jointure des deux PROPOSE la photo, et la famille confirme.
--
-- Fouka, en testant le 28/09 : « il dit aucun numéro n'est encore relevé sur ces photos ». C'était
-- exact — sur 6 295 photos, AUCUNE ne portait de numéro, la fonction datant de la veille. Ce test
-- existe pour qu'on n'ait plus jamais à se demander si la chaîne marche ou si elle n'a rien à se
-- mettre sous la dent : il relève des numéros, en déclare un, et vérifie ce qui est proposé.
--
-- LES DEUX BORNES, qui comptent autant que la proposition :
--   • un numéro que personne n'a relevé ne donne rien, et ne se plaint pas ;
--   • si DEUX joueurs déclarent le même numéro sur le même match, on ne donne rien du tout —
--     deux joueurs ne partagent pas un numéro, et on ne devine pas lequel des deux a raison.
--
-- Décor fictif, tout est annulé.

do $$
declare
  v_club uuid; v_equipe uuid; v_saison uuid; v_album uuid;
  v_j1 uuid; v_j2 uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_admin uuid := 'fa110000-0000-0000-0000-000000000001';
  v_f1 uuid := 'fa110000-0000-0000-0000-000000000011';
  v_f2 uuid := 'fa110000-0000-0000-0000-000000000012';
  v_rapport text := ''; n int; r jsonb;
begin
  select id into v_saison from saisons where active order by label desc limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
  values (v_admin, 'zz-num-admin@example.invalid', '', now(), 'authenticated', 'authenticated')
  on conflict (id) do nothing;
  insert into profiles (id, role, actif) values (v_admin, 'admin', true)
  on conflict (id) do update set role = 'admin', actif = true;

  insert into clubs (id, nom, plan) values (gen_random_uuid(), 'ZZ Club Numero', 'performance')
  returning id into v_club;
  insert into club_teams (club_id, name) values (v_club, 'ZZ U14 Numero') returning id into v_equipe;

  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
  values (v_club, 'ZZ', 'Numero Sept', date '2012-01-01', 'actif') returning id into v_j1;
  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
  values (v_club, 'ZZ', 'Numero Onze', date '2012-02-02', 'actif') returning id into v_j2;
  insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
  values (v_equipe, v_j1, v_club, v_saison, (select label from saisons where id = v_saison), 'active'),
         (v_equipe, v_j2, v_club, v_saison, (select label from saisons where id = v_saison), 'active');

  -- Les deux familles. Declarer son numero exige d'etre le sportif ou son parent CONFIRME : c'est
  -- la borne du geste, et le test ne vaut que s'il la respecte.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
    (v_f1, 'zz-num-f1@example.invalid', '', now(), 'authenticated', 'authenticated'),
    (v_f2, 'zz-num-f2@example.invalid', '', now(), 'authenticated', 'authenticated')
  on conflict (id) do nothing;
  insert into parent_profiles (id, user_id, prenom, nom) values
    (v_f1, v_f1, 'ZZ', 'Parent Sept'), (v_f2, v_f2, 'ZZ', 'Parent Onze')
  on conflict (id) do nothing;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at) values
    (v_f1, v_j1, 'parent', 'confirme', now()), (v_f2, v_j2, 'parent', 'confirme', now());

  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
  values (v_club, v_equipe, v_saison, 'ZZ Match avec numeros', 'published', current_date, now())
  returning id into v_album;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
  values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/n1.jpg', 'zz/n1-p.webp', 'zz/n1-t.webp', 'ready', 1, true) returning id into v_p1;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
  values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/n2.jpg', 'zz/n2-p.webp', 'zz/n2-t.webp', 'ready', 2, true) returning id into v_p2;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
  values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/n3.jpg', 'zz/n3-p.webp', 'zz/n3-t.webp', 'ready', 3, true) returning id into v_p3;

  -- ── CÔTÉ OS : on relève ce qu'on lit sur les photos, sans savoir qui c'est ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  n := media_numeros_de_la_photo(v_p1, array[7, 11]::smallint[]);
  n := media_numeros_de_la_photo(v_p2, array[7]::smallint[]);
  -- la troisième photo ne porte aucun numéro lisible, et c'est fréquent
  select count(*) into n from media_assets where album_id = v_album and cardinality(numeros_visibles) > 0;
  if n = 2 then v_rapport := v_rapport || E'\n  vert   l''OS releve les numeros lisibles : 2 photos sur 3';
  else v_rapport := v_rapport || format(E'\n  ROUGE  numeros releves sur %s photos au lieu de 2', n); end if;

  -- ── CÔTÉ FAMILLE : « à ce match, j'étais le 7 » ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_f1, 'role', 'authenticated')::text, true);
  r := media_declarer_mon_numero(v_album, v_j1, 7::smallint);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  n := media_suggerer_par_numero(v_album);
  -- ARBITRE PAR FOUKA LE 29/09/2026 : LES PHOTOS ENTRENT DIRECTEMENT DANS SA GALERIE.
  --
  -- Ce test exigeait des suggestions, et qu'aucun marquage ne soit valide « tant que la famille n'a
  -- pas confirme ». Fouka a tranche l'autre sens : « ca lui propose pas est-ce que c'est vous. Des
  -- que tu es sur, boum, tu les mets dans sa galerie. » Les garde-fous qui restent sont verifies
  -- plus bas — numero jamais releve, numero revendique par deux enfants — et la contrepartie est
  -- que la famille peut RETIRER une photo arrivee par le numero (v343) : elle corrige apres au lieu
  -- de confirmer avant.
  select count(*) into n from media_player_tags t join media_assets a on a.id = t.media_ref_id
   where a.album_id = v_album and t.player_id = v_j1 and t.statut = 'valide' and t.source = 'numero';
  if n = 2 then v_rapport := v_rapport || E'\n  vert   les 2 photos portant le n°7 entrent dans sa galerie';
  else v_rapport := v_rapport || format(E'\n  ROUGE  %s photo(s) entree(s) au lieu de 2', n); end if;

  -- LA TRACE FAIT PARTIE DE LA REGLE. `source = 'numero'` est ce qui permet a la famille de retirer
  -- ces photos : une entree directe sans trace serait une entree sans retour.
  select count(*) into n from media_player_tags t join media_assets a on a.id = t.media_ref_id
   where a.album_id = v_album and t.player_id = v_j1 and t.statut = 'valide' and t.source <> 'numero';
  if n = 0 then v_rapport := v_rapport || E'\n  vert   chaque photo porte la trace « numero » qui permet de la retirer';
  else v_rapport := v_rapport || format(E'\n  ROUGE  %s photo(s) entree(s) sans trace', n); end if;

  -- ── UN NUMERO QUE PERSONNE N'A RELEVE ne propose rien, et ne se plaint pas ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_f2, 'role', 'authenticated')::text, true);
  r := media_declarer_mon_numero(v_album, v_j2, 23::smallint);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  n := media_suggerer_par_numero(v_album);
  select count(*) into n from media_player_tags t join media_assets a on a.id = t.media_ref_id
   where a.album_id = v_album and t.player_id = v_j2;
  if n = 0 then v_rapport := v_rapport || E'\n  vert   un numero jamais releve ne propose rien';
  else v_rapport := v_rapport || format(E'\n  ROUGE  %s photo(s) proposee(s) pour un numero absent', n); end if;

  -- ── DEUX JOUEURS, LE MEME NUMERO : on ne propose plus rien a personne ──
  delete from media_player_tags t using media_assets a
   where a.id = t.media_ref_id and a.album_id = v_album;
  perform set_config('request.jwt.claims', json_build_object('sub', v_f2, 'role', 'authenticated')::text, true);
  r := media_declarer_mon_numero(v_album, v_j2, 7::smallint);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  n := media_suggerer_par_numero(v_album);
  select count(*) into n from media_player_tags t join media_assets a on a.id = t.media_ref_id
   where a.album_id = v_album;
  if n = 0 then v_rapport := v_rapport || E'\n  vert   deux joueurs sur le meme numero : rien n''est propose a personne';
  else v_rapport := v_rapport || format(E'\n  ROUGE  %s proposition(s) alors que le numero est dispute', n); end if;

  raise exception E'%\n', v_rapport using errcode = 'P0001';
end $$;
