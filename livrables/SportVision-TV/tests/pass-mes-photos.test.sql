-- « Mes photos, plus les photos de groupe » : ce que le Pass ouvre vraiment (v219, 14/09/2026).
--
-- LE MODÈLE DÉCIDÉ PAR FOUKA. Le Pass est payé par la famille d'UN joueur. À chaque prestation,
-- elle reçoit les photos de SON enfant : aperçu filigrané d'abord, accès complet une fois le Pass
-- payé, pour toute la saison. Elle accède à ses photos marquées ET aux photos de groupe. Une photo
-- où personne n'est marqué reste à SportVision et à l'encadrement du club.
--
-- POURQUOI CE TEST. Jusqu'à la v219, tout se décidait par ALBUM : un droit ouvrait la galerie
-- entière, donc les photos des autres enfants. La règle « mes photos » ne vaut que si elle tient
-- photo par photo, y compris pour quelqu'un qui a payé — c'est précisément le cas où l'on est
-- tenté de tout ouvrir.
--
-- CE QU'ON MESURE, sur une galerie contenant quatre photos : une de Lina, une de Sacha, une de
-- groupe, une sans marquage.
--   1. Sans Pass : la famille de Lina ne télécharge rien, même sa propre photo.
--   2. Avec le Pass : sa photo, oui. La photo de groupe, oui.
--   3. La photo de Sacha, NON — c'est le cœur du modèle.
--   4. La photo sans marquage, NON plus.
--   5. La liste qu'on lui montre contient exactement deux photos : la sienne et celle de groupe.
--   6. Une famille ne peut pas demander la liste des photos de l'enfant d'une autre.
--   7. Un Pass d'une autre saison n'ouvre rien.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.serveur() returns void language plpgsql as $i$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
end $i$;

do $$
declare
  v_club uuid; v_equipe uuid; v_saison uuid; v_saison2 uuid; v_album uuid;
  v_lina uuid; v_sacha uuid; v_cpt_lina uuid; v_cpt_sacha uuid;
  ph_lina uuid; ph_sacha uuid; ph_groupe uuid; ph_orpheline uuid;
  e text[] := '{}'; n int;
begin
  perform pg_temp.serveur();

  select id into v_saison from saisons where label = '2026-2027';
  select id into v_saison2 from saisons where label = '2027-2028';

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values (v_club,'club','ZZ Club MesPhotos','actif_standard');
  insert into clubs (id, nom, plan, saison_id) values (v_club,'ZZ Club MesPhotos','performance', v_saison);
  insert into club_teams (club_id, name) values (v_club,'ZZ MP U13') returning id into v_equipe;
  insert into media_club_policy (club_id, saison_id, default_policy, status)
    values (v_club, v_saison, 'pass_saison', 'active');

  -- Deux familles, deux enfants dans la même équipe.
  v_cpt_lina := gen_random_uuid(); v_cpt_sacha := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_cpt_lina,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-mp-lina@example.invalid','',now(),now(),now()),
      (v_cpt_sacha,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-mp-sacha@example.invalid','',now(),now(),now());
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_cpt_lina,'ZZ','Lina', v_club, date '2013-01-01') returning id into v_lina;
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_cpt_sacha,'ZZ','Sacha', v_club, date '2013-02-02') returning id into v_sacha;
  insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut) values
    (v_lina, v_equipe, v_club, '2026-2027', v_saison, 'active'),
    (v_sacha, v_equipe, v_club, '2026-2027', v_saison, 'active');

  -- La galerie du match, et ses quatre photos.
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date)
    values (v_club, v_equipe, v_saison, 'ZZ Match MesPhotos', 'published', current_date) returning id into v_album;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/mp-lina.jpg', 'ready', 1) returning id into ph_lina;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/mp-sacha.jpg', 'ready', 2) returning id into ph_sacha;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position, photo_de_groupe)
    values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/mp-groupe.jpg', 'ready', 3, true) returning id into ph_groupe;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo', 'sportvision-media-prive', 'zz/mp-orpheline.jpg', 'ready', 4) returning id into ph_orpheline;

  insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut) values
    ('media_asset', ph_lina, v_lina, 'humain', 'valide'),
    ('media_asset', ph_sacha, v_sacha, 'humain', 'valide');

  -- ══ 1. SANS PASS, RIEN NE SE TÉLÉCHARGE ══════════════════════════════════
  perform pg_temp.incarner(v_cpt_lina);
  if can_access_asset(ph_lina) then e := e || 'sans Pass, la famille telecharge deja sa photo'::text; end if;
  if can_access_asset(ph_groupe) then e := e || 'sans Pass, la photo de groupe est ouverte'::text; end if;

  -- ══ 2. AVEC LE PASS : SA PHOTO ET LE GROUPE ══════════════════════════════
  perform pg_temp.serveur();
  insert into media_entitlements (club_id, saison_id, beneficiary_person_id, purchased_by_user_id, scope_type, scope_id, status)
    values (v_club, v_saison, v_lina, v_cpt_lina, 'club', v_club, 'active');

  perform pg_temp.incarner(v_cpt_lina);
  if not can_access_asset(ph_lina) then e := e || 'avec le Pass, sa propre photo reste fermee'::text; end if;
  if not can_access_asset(ph_groupe) then e := e || 'avec le Pass, la photo de groupe reste fermee'::text; end if;

  -- ══ 3. LA PHOTO DE L'AUTRE ENFANT, JAMAIS ════════════════════════════════
  if can_access_asset(ph_sacha) then e := e || 'le Pass ouvre la photo de l enfant d une autre famille'::text; end if;

  -- ══ 4. NI LA PHOTO QUE PERSONNE N'A MARQUÉE ══════════════════════════════
  if can_access_asset(ph_orpheline) then e := e || 'le Pass ouvre une photo sans marquage'::text; end if;

  -- ══ 5. CE QU'ON LUI MONTRE : DEUX PHOTOS, PAS QUATRE ═════════════════════
  select count(*) into n from media_photos_pour_famille(v_album, v_lina);
  if n <> 2 then e := e || format('la liste rend %s photo(s) au lieu de 2', n); end if;
  select count(*) into n from media_photos_pour_famille(v_album, v_lina) where asset_id = ph_sacha;
  if n <> 0 then e := e || 'la photo de l autre enfant figure dans la liste'::text; end if;
  select count(*) into n from media_photos_pour_famille(v_album, v_lina) where de_groupe;
  if n <> 1 then e := e || format('photo de groupe dans la liste : %s au lieu de 1', n); end if;

  -- ══ 6. PAS DE LISTE SUR L'ENFANT D'UNE AUTRE FAMILLE ═════════════════════
  select count(*) into n from media_photos_pour_famille(v_album, v_sacha);
  if n <> 0 then e := e || format('la famille de Lina lit %s photo(s) de Sacha', n); end if;

  -- ══ 7. UN PASS D'UNE AUTRE SAISON N'OUVRE RIEN ═══════════════════════════
  perform pg_temp.serveur();
  update media_entitlements set saison_id = v_saison2 where purchased_by_user_id = v_cpt_lina;
  perform pg_temp.incarner(v_cpt_lina);
  if can_access_asset(ph_lina) then e := e || 'un Pass d une autre saison ouvre les photos'::text; end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — sans Pass rien ne se télécharge ; avec le Pass, ses photos marquées et les photos de groupe, jamais celles d''un autre enfant ni celles que personne n''a marquées ; la liste montrée à la famille contient exactement ses photos ; un Pass d''une autre saison n''ouvre rien.' as verdict;

rollback;
