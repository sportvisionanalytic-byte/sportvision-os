-- « À ce match-là, j'étais le numéro 7 » — les photos de dos rejoignent les siennes.
--
-- CE QUE ÇA RÉSOUT (demande de Fouka, 27/09/2026). Un moteur de visages ne rend RIEN sur une photo de
-- dos, et c'est une grande part d'un match. Le dossard y est lisible, mais un modèle qui lit « 7 » ne
-- saura jamais QUI portait le 7 ce jour-là. La famille, elle, le sait. D'où le partage du travail :
-- « on voit le 7 sur cette photo » d'un côté, « j'étais le 7 à ce match » de l'autre, la jointure
-- entre les deux.
--
-- ET POURQUOI PAR MATCH ET NON PAR SAISON : en jeunes le numéro change souvent. Un numéro de saison
-- serait faux une fois sur trois, et un faux numéro attribue la photo d'un enfant à un autre.
--
-- ARBITRÉ PAR FOUKA LE 29/09/2026 : LES PHOTOS ENTRENT DIRECTEMENT DANS SA GALERIE.
--
-- Ce test exigeait des SUGGESTIONS — « est-ce bien vous ? » — au motif qu'une déclaration n'est pas
-- vérifiable : un enfant peut se tromper de numéro, deux enfants peuvent avoir échangé de maillot.
-- Le raisonnement tient toujours. Mais Fouka a tranché l'autre sens, et sa règle est plus large :
-- « ça lui propose pas est-ce que c'est vous, est-ce que c'est vous. C'est seulement s'il y a des
-- doutes. Dès que tu es sûr, boum, tu les mets dans sa galerie. » Un écran de confirmation par photo
-- est un écran de trop pour une famille qui vient d'en payer trente-neuf euros quatre-vingt-dix.
--
-- CE QUI REND CE CHOIX TENABLE, et il faut le garder sous les yeux : trois garde-fous restent, et ce
-- sont eux que ce test vérifie maintenant.
--   1. Déclarer un numéro fait entrer les photos qui le portent, et RIEN de plus.
--   2. Si DEUX enfants revendiquent le même numéro, personne ne reçoit rien. Deviner entre deux
--      enfants serait pire que ne rien faire.
--   3. Une décision déjà prise n'est jamais repassée par-dessus — ni un « c'est moi », ni un refus.
--      Une famille qui a dit « ce n'est pas moi » ne se le voit pas remettre.
--   4. Et la contrepartie, sans laquelle l'entrée directe serait indéfendable (v343) : la famille
--      peut RETIRER une photo arrivée par le numéro. Elle ne confirme plus avant, elle corrige après.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_saison uuid; v_equipe uuid; v_album uuid;
  u1 uuid; u2 uuid; j1 uuid; j2 uuid;
  ph7 uuid; ph7bis uuid; ph9 uuid; ph_rien uuid; ph_refus uuid;
  v_res jsonb; e text[] := '{}'; n int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;

  insert into clubs (nom, plan) values ('ZZ Club Dossard','performance') returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ Dossard U13') returning id into v_equipe;
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_equipe, v_saison, 'ZZ Match Dossard', 'published', current_date, now())
    returning id into v_album;

  -- Cinq photos : deux portent le 7, une le 9, une aucun numero lisible, une le 7 aussi mais deja
  -- refusee par la famille.
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position, numeros_visibles)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/d1.jpg','ap/d1.webp','ready',1, '{7}') returning id into ph7;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position, numeros_visibles)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/d2.jpg','ap/d2.webp','ready',2, '{7,11}') returning id into ph7bis;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position, numeros_visibles)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/d3.jpg','ap/d3.webp','ready',3, '{9}') returning id into ph9;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/d4.jpg','ap/d4.webp','ready',4) returning id into ph_rien;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position, numeros_visibles)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/d5.jpg','ap/d5.webp','ready',5, '{7}') returning id into ph_refus;

  u1 := gen_random_uuid(); u2 := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
   values (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-dossard-1@example.invalid','',now(),now(),now()),
          (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-dossard-2@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, u1,'ZZ','Sept','2013-07-07','actif') returning id into j1;
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, u2,'ZZ','Neuf','2013-09-09','actif') returning id into j2;
  insert into team_memberships (player_id, team_id, club_id, saison, statut) values
    (j1, v_equipe, v_club,'2026-2027','active'),
    (j2, v_equipe, v_club,'2026-2027','active');

  -- La famille du premier a deja dit « ce n'est pas moi » sur une photo qui porte le 7.
  insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
    values ('media_asset', ph_refus, j1, 'famille', 'rejete');

  -- ══ 1. IL DÉCLARE LE 7 ═══════════════════════════════════════════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',u1::text,'role','authenticated')::text, true);
  v_res := media_declarer_mon_numero(v_album, j1, 7::smallint);
  if (v_res->>'photos_avec_ce_numero')::int <> 3 then
    e := e || format('le 7 est lisible sur %s photo(s) au lieu de 3', v_res->>'photos_avec_ce_numero');
  end if;
  if (v_res->>'conflit')::boolean then e := e || 'un conflit est signale alors qu il est seul'::text; end if;

  perform set_config('role','postgres',true);
  select count(*) into n from media_player_tags
   where media_ref_type='media_asset' and player_id=j1 and statut='valide' and source='numero'
     and media_ref_id in (ph7, ph7bis);
  if n <> 2 then e := e || format('%s photo(s) entrees dans sa galerie au lieu des 2 qui portent le 7', n); end if;

  -- ══ 2. RIEN DE PLUS : PAS LE 9, PAS LA PHOTO SANS NUMÉRO ═════════════════
  select count(*) into n from media_player_tags
   where media_ref_type='media_asset' and player_id=j1 and media_ref_id in (ph9, ph_rien);
  if n <> 0 then e := e || 'une photo sans son numero lui a ete proposee'::text; end if;

  -- ══ 3. ET LA TRACE DIT D'OU ELLES VIENNENT ═══════════════════════════════
  --
  -- `source = 'numero'` n'est pas decoratif : c'est ce qui permet a la famille de retirer ces photos
  -- (v343) et a nous de savoir, plus tard, lesquelles reposaient sur une declaration plutot que sur
  -- un visage reconnu. Une entree directe sans trace serait une entree sans retour.
  select count(*) into n from media_player_tags
   where media_ref_type='media_asset' and player_id=j1 and statut='valide'
     and media_ref_id in (ph7, ph7bis) and source <> 'numero';
  if n <> 0 then e := e || format('%s photo(s) entree(s) sans porter la trace « numero »', n); end if;

  -- ══ 4. UN REFUS DÉJÀ EXPRIMÉ N'EST PAS REPROPOSÉ ═════════════════════════
  select count(*) into n from media_player_tags
   where media_ref_type='media_asset' and player_id=j1 and media_ref_id=ph_refus
     and statut in ('propose','valide');
  if n <> 0 then e := e || 'une photo deja refusee par la famille lui est representee'::text; end if;

  -- ══ 5. DEUX ENFANTS, LE MÊME NUMÉRO : ON NE PROPOSE RIEN ═════════════════
  perform set_config('role','postgres',true);
  delete from media_player_tags where media_ref_type='media_asset' and source='numero'
   and media_ref_id in (select id from media_assets where album_id=v_album);
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',u2::text,'role','authenticated')::text, true);
  v_res := media_declarer_mon_numero(v_album, j2, 7::smallint);
  if not (v_res->>'conflit')::boolean then
    e := e || 'deux enfants revendiquent le 7 et aucun conflit n est signale'::text;
  end if;
  perform set_config('role','postgres',true);
  select count(*) into n from media_player_tags
   where media_ref_type='media_asset' and source='numero' and player_id in (j1, j2);
  if n <> 0 then
    e := e || format('%s photo(s) donnee(s) malgre le numero revendique par deux enfants', n);
  end if;

  -- ══ 6. UNE FAMILLE NE DÉCLARE QUE POUR SON ENFANT ════════════════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',u2::text,'role','authenticated')::text, true);
  begin
    perform media_declarer_mon_numero(v_album, j1, 5::smallint);
    e := e || 'une famille a declare un numero pour l enfant d une autre'::text;
  exception when others then null;
  end;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : le numero declare fait entrer les photos qui le portent, rien de plus, jamais quand deux enfants le revendiquent, et toujours avec la trace qui permet de les retirer';
end $$;
