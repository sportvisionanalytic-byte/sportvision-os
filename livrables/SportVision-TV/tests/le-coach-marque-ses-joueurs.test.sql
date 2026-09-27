-- Le coach marque ses joueurs sur les photos — là où il a le droit de voir, et nulle part ailleurs.
--
-- POURQUOI C'EST LE CHANTIER QUI RAPPORTE LE PLUS (28/09/2026) : 5 646 photos prêtes, 0 marquage.
-- Tant que rien ne relie une photo à un enfant, une famille qui paie le Pass voit ses quatre photos
-- d'aperçu et plus rien. Le coach est le seul qui reconnaît ses joueurs de dos, de loin, flous — sans
-- aucun modèle.
--
-- CE QUE LE MARQUAGE DONNE COMME POUVOIR, et c'est ce que ce test surveille : un marquage humain vaut
-- `valide`, donc il OUVRE la photo à la famille de l'enfant marqué. Se tromper de joueur montre la
-- photo d'un enfant à la mauvaise famille. D'où les trois bornes :
--   1. le coach marque dans les galeries de SES équipes, jamais dans celles d'une autre catégorie ;
--   2. il ne peut rattacher qu'un joueur du CLUB de la galerie (v309) ;
--   3. un club ne touche jamais aux galeries d'un autre club.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_autre_club uuid; v_saison uuid; v_eqA uuid; v_eqB uuid;
  v_gal_A uuid; v_gal_B uuid; v_gal_autre uuid; ph_A uuid; ph_autre uuid;
  v_coach uuid; v_joueur uuid; v_joueur_b uuid; v_etranger uuid; u uuid;
  e text[] := '{}'; n int; m text;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;

  insert into clubs (nom, plan) values ('ZZ Club Coach','performance') returning id into v_club;
  insert into clubs (nom, plan) values ('ZZ Club Voisin C','performance') returning id into v_autre_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ Coach U13') returning id into v_eqA;
  insert into club_teams (club_id, name) values (v_club,'ZZ Coach U15') returning id into v_eqB;

  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_eqA, v_saison, 'ZZ Galerie U13', 'published', current_date, now()) returning id into v_gal_A;
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_eqB, v_saison, 'ZZ Galerie U15', 'published', current_date, now()) returning id into v_gal_B;
  insert into media_albums (club_id, saison_id, title, status, event_date, published_at)
    values (v_autre_club, v_saison, 'ZZ Galerie du voisin', 'published', current_date, now()) returning id into v_gal_autre;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
    values (v_gal_A, v_club,'photo','sportvision-media-prive','zz/co1.jpg','ap/co1-p.webp','ap/co1-t.webp','ready',1,true)
    returning id into ph_A;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
    values (v_gal_autre, v_autre_club,'photo','sportvision-media-prive','zz/co2.jpg','ap/co2-p.webp','ap/co2-t.webp','ready',1,true)
    returning id into ph_autre;

  -- Le coach des U13, et nulle part ailleurs.
  v_coach := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coach-marque@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status, teams)
    values (v_club, v_coach, 'coach', 'actif', to_jsonb(array['ZZ Coach U13']));

  -- Un joueur de son equipe, un joueur d'une autre equipe du club, un enfant du club voisin.
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coach-j1@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, u,'ZZ','JoueurU13','2013-01-01','actif') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur, v_eqA, v_club,'2026-2027','active');
  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values (v_club,'ZZ','JoueurU15','2011-01-01','actif') returning id into v_joueur_b;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur_b, v_eqB, v_club,'2026-2027','active');
  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values (v_autre_club,'ZZ','Etranger','2013-05-05','actif') returning id into v_etranger;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_coach::text,'role','authenticated')::text, true);

  -- ══ 1. IL MARQUE DANS LA GALERIE DE SON ÉQUIPE ═══════════════════════════
  if not peut_marquer_galerie(v_gal_A) then
    e := e || 'le coach ne peut pas marquer dans la galerie de SON equipe'::text; end if;
  begin
    perform media_rattacher_joueur(ph_A, v_joueur, true);
  exception when others then
    e := e || ('le rattachement a echoue : '||left(sqlerrm,60))::text;
  end;
  -- ON LIT LE MARQUAGE COTE SERVEUR, et ce detail m'a d'abord fait accuser le produit a tort : la
  -- table media_player_tags a sa propre RLS, et le coach n'y lit pas. Compter avec ses droits
  -- rendait zero alors que le marquage existait.
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select count(*) into n from media_player_tags
   where media_ref_id = ph_A and player_id = v_joueur and statut = 'valide';
  if n <> 1 then e := e || 'le marquage n est pas valide'::text; end if;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_coach::text,'role','authenticated')::text, true);

  -- ══ 2. UN JOUEUR HORS CATÉGORIE RESTE RATTACHABLE (v309) ═════════════════
  --
  -- Un U15 a pu jouer avec les U13 : le coach doit pouvoir le dire. La liste le signale comme hors
  -- categorie, elle ne l'interdit pas.
  select count(*) into n from media_joueurs_de_galerie(v_gal_A) x
   where x.player_id = v_joueur_b and x.hors_categorie;
  if n <> 1 then e := e || 'un joueur d une autre equipe du club n est pas propose (ou pas signale)'::text; end if;

  -- ══ 3. PAS DANS LA GALERIE D'UNE AUTRE CATÉGORIE ═════════════════════════
  if peut_marquer_galerie(v_gal_B) then
    e := e || 'le coach des U13 peut marquer dans la galerie des U15'::text; end if;

  -- ══ 4. ET JAMAIS CHEZ LE VOISIN ══════════════════════════════════════════
  if peut_marquer_galerie(v_gal_autre) then
    e := e || 'le coach peut marquer dans la galerie d un AUTRE club'::text; end if;
  m := null;
  begin perform media_rattacher_joueur(ph_autre, v_joueur, true); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'une photo d un autre club a ete marquee'::text; end if;
  -- Et on ne rattache pas l'enfant du voisin a une photo de chez soi.
  m := null;
  begin perform media_rattacher_joueur(ph_A, v_etranger, true); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'un enfant d un AUTRE club a ete rattache'::text; end if;

  -- ══ 5. LE MARQUAGE OUVRE BIEN LA PHOTO À LA FAMILLE QUI A PAYÉ ══════════
  --
  -- C'est tout l'objet : sans cette derniere verification, le coach marquerait dans le vide.
  --
  -- LE PASS EST INDISPENSABLE ICI, et ma premiere version l'avait oublie : `can_access_asset` exige
  -- D'ABORD le droit sur la galerie (paye), PUIS un marquage sur la photo. Les deux conditions sont
  -- distinctes — le marquage designe QUI est dessus, le Pass donne le droit de la voir. Tester sans
  -- Pass faisait echouer le test sur une regle qui fonctionne.
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into media_entitlements (club_id, saison_id, beneficiary_person_id, purchased_by_user_id,
                                  scope_type, scope_id, status)
    values (v_club, v_saison, v_joueur, u, 'club', v_club, 'active');
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',u::text,'role','authenticated')::text, true);
  if not can_access_asset(ph_A) then
    e := e || 'la famille a paye, la photo lui est attribuee, et elle n y accede pas'::text;
  end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : le coach marque dans ses galeries, un surclasse reste rattachable, et rien ne deborde sur un autre club';
end $$;
