-- Un U14 qui joue en U16 est reconnu dans la galerie du match qu'il a joué.
--
-- DEMANDE DE FOUKA (27/09/2026) : « parfois il y a un U14 qui joue en U15 ou U16. Il faudrait quand
-- même que ça le reconnaisse automatiquement s'il a mis la reconnaissance faciale. Après ça lui met
-- une proposition, est-ce que c'est bien toi. »
--
-- LA FRONTIÈRE N'EST PAS AU MÊME ENDROIT SELON LE GESTE, et c'est tout l'objet de ce test :
--
--   RATTACHER (staff, reconnaissance)   le CLUB suffit — quelqu'un a constaté la présence
--   LIRE ET CONFIRMER (famille)         son équipe, OU un marquage qui existe déjà
--   DÉCLARER SON NUMÉRO (famille)       son équipe SEULEMENT
--
-- La dernière ligne est la brèche qu'un élargissement uniforme aurait ouverte : si une famille
-- pouvait déclarer un numéro sur une galerie d'une autre catégorie, il suffirait de deviner un numéro
-- courant pour s'attacher à la photo d'un autre enfant, puis la voir. Hors catégorie, le premier lien
-- vient toujours d'un humain ou de la reconnaissance.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_autre_club uuid; v_saison uuid; v_u14 uuid; v_u16 uuid;
  v_gal_u16 uuid; v_gal_u14 uuid; ph1 uuid; ph2 uuid;
  u_surclasse uuid; j_surclasse uuid; u_etranger uuid; j_etranger uuid; v_staff uuid;
  e text[] := '{}'; n int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;
  select id into v_staff from profiles where role='admin' and actif order by created_at limit 1;

  insert into clubs (nom, plan) values ('ZZ Club Surclasse','performance') returning id into v_club;
  insert into clubs (nom, plan) values ('ZZ Club Voisin S','performance') returning id into v_autre_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ S U14') returning id into v_u14;
  insert into club_teams (club_id, name) values (v_club,'ZZ S U16') returning id into v_u16;

  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_u16, v_saison, 'ZZ Match U16', 'published', current_date, now()) returning id into v_gal_u16;
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_u14, v_saison, 'ZZ Match U14', 'published', current_date, now()) returning id into v_gal_u14;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position, numeros_visibles)
    values (v_gal_u16, v_club,'photo','sportvision-media-prive','zz/s1.jpg','ap/s1.webp','ready',1,'{7}') returning id into ph1;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, status, position)
    values (v_gal_u16, v_club,'photo','sportvision-media-prive','zz/s2.jpg','ap/s2.webp','ready',2) returning id into ph2;

  -- Le surclassé : inscrit en U14, il a joué le match U16.
  u_surclasse := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u_surclasse,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-surclasse@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, u_surclasse,'ZZ','Surclasse','2012-02-02','actif') returning id into j_surclasse;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (j_surclasse, v_u14, v_club,'2026-2027','active');

  -- Un enfant d'un AUTRE club, qui ne doit jamais pouvoir etre rattache.
  u_etranger := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u_etranger,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-surclasse-etranger@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_autre_club, u_etranger,'ZZ','Etranger','2012-03-03','actif') returning id into j_etranger;

  -- ══ 1. AVANT TOUT MARQUAGE : LA GALERIE U16 NE LE CONCERNE PAS ═══════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',u_surclasse::text,'role','authenticated')::text, true);
  if media_galerie_concerne_le_joueur(v_gal_u16, j_surclasse) then
    e := e || 'la galerie U16 le concerne deja alors que rien ne l y relie'::text;
  end if;
  select count(*) into n from media_photos_du_joueur(v_gal_u16, j_surclasse);
  if n <> 0 then e := e || format('%s photo(s) U16 servies avant tout marquage', n); end if;

  -- ══ 2. LA BRÈCHE RESTE FERMÉE : il ne DÉCLARE pas un numéro hors catégorie
  begin
    perform media_declarer_mon_numero(v_gal_u16, j_surclasse, 7::smallint);
    e := e || 'une famille a pu AFFIRMER une presence hors categorie en declarant un numero'::text;
  exception when others then null;
  end;

  -- ══ 3. LE STAFF LE RATTACHE, HORS CATÉGORIE : C'EST PERMIS (v309) ════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'role','authenticated')::text, true);
  begin
    perform media_rattacher_joueur(ph1, j_surclasse, true);
  exception when others then
    e := e || ('le staff n a PAS pu rattacher un surclasse : '||left(sqlerrm,60))::text;
  end;
  -- Mais un enfant d'un autre club, jamais.
  begin
    perform media_rattacher_joueur(ph2, j_etranger, true);
    e := e || 'un enfant d un AUTRE club a ete rattache'::text;
  exception when others then null;
  end;
  -- Et il apparait bien dans la liste de l OS, signale hors categorie.
  select count(*) into n from media_joueurs_de_galerie(v_gal_u16) x
   where x.player_id = j_surclasse and x.hors_categorie;
  if n <> 1 then e := e || 'le surclasse n apparait pas (ou pas signale) dans la liste de l OS'::text; end if;

  -- ══ 4. DÈS LORS, SA FAMILLE VOIT ET PEUT CONFIRMER ═══════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',u_surclasse::text,'role','authenticated')::text, true);
  if not media_galerie_concerne_le_joueur(v_gal_u16, j_surclasse) then
    e := e || 'la galerie U16 ne le concerne toujours pas malgre un marquage pose'::text;
  end if;
  begin
    perform media_famille_marque(ph1, j_surclasse, true);
  exception when others then
    e := e || ('sa famille n a pas pu confirmer hors categorie : '||left(sqlerrm,60))::text;
  end;

  -- ══ 5. ET CE N'EST PAS UNE PORTE OUVERTE SUR LE CLUB ═════════════════════
  --
  -- La galerie U14 est la sienne (son equipe) ; une galerie d'une TROISIEME categorie ou rien ne le
  -- relie doit rester fermee, sinon on retombe sur « tout le monde voit les galeries de tout le monde ».
  if not media_galerie_concerne_le_joueur(v_gal_u14, j_surclasse) then
    e := e || 'la galerie de SON equipe ne le concerne pas'::text;
  end if;
  perform set_config('role','postgres',true);
  delete from media_player_tags where media_ref_id = ph1 and player_id = j_surclasse;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',u_surclasse::text,'role','authenticated')::text, true);
  if media_galerie_concerne_le_joueur(v_gal_u16, j_surclasse) then
    e := e || 'la galerie U16 le concerne encore apres retrait du marquage'::text;
  end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : le surclasse est rattachable par le staff, sa famille confirme ensuite, et elle ne peut pas l affirmer elle-meme';
end $$;
