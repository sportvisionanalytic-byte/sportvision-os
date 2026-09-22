-- Le joueur voit les matchs de son équipe (v251, 22/09/2026).
--
-- CE QUI NE MARCHAIT PAS. Les matchs importés de la fédération portent le nom d'équipe de la
-- fédération (« U18 1 ») pendant que le club nomme ses équipes autrement (« U18 R3 »). Les deux
-- règles de lecture de la famille, cma_family_select et ccal_family_select, comparaient ces deux
-- noms. Sur 670 matchs en base, 665 portaient pourtant un team_id juste, et seulement 244 un nom
-- qui correspondait : un joueur affilié à une équipe réelle ouvrait donc un calendrier vide, sans
-- message d'erreur et sans que rien ne signale le problème.
--
-- CE QU'ON MESURE :
--   1. Le joueur voit le match rattaché à son équipe par team_id, même si le nom diffère.
--   2. Son parent confirmé le voit aussi.
--   3. L'entraînement rattaché par team_id remonte de la même façon.
--   4. Le match d'une AUTRE équipe du même club reste invisible : on ouvre par l'identifiant,
--      on n'ouvre pas le club entier.
--   5. L'ancien chemin par le nom continue de fonctionner quand il n'y a pas de team_id.

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
  v_joueur uuid; v_parent uuid; v_cm uuid;
  v_client uuid; v_club uuid; v_team uuid; v_autre_team uuid;
  v_pp uuid; v_pf uuid;
  n int; e text[] := '{}';
begin
  perform pg_temp.serveur();

  v_joueur := gen_random_uuid(); v_parent := gen_random_uuid(); v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_joueur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-vm-joueur@example.invalid','',now(),now(),now()),
    (v_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-vm-parent@example.invalid','',now(),now(),now()),
    (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-vm-cm@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values (v_cm,'ZZ','CmMatch','zz-vm-cm@example.invalid','cm',true);

  insert into clients (nom, statut, cm_id) values ('ZZ Client Matchs','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Matchs','performance', v_client) returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ U18 R3') returning id into v_team;
  insert into club_teams (club_id, name) values (v_club,'ZZ Séniors R2') returning id into v_autre_team;

  insert into player_profiles (user_id, club_id, prenom, nom, date_naissance, account_status)
    values (v_joueur, v_club,'ZZ','JoueurMatch','2009-03-03','actif') returning id into v_pp;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_pp, v_team, v_club, '2026-2027', 'active');

  insert into parent_profiles (user_id, prenom, nom) values (v_parent,'ZZ','ParentMatch') returning id into v_pf;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
    values (v_pf, v_pp, 'parent', 'confirme', now());

  -- Le cas réel : la fédération nomme l'équipe autrement que le club, mais le rattachement par
  -- identifiant est juste.
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
    values (v_club,'ZZ U18 1', v_team,'ZZ Adversaire Federation', current_date + 3, '15:00');
  -- Le match d'une autre équipe du club : hors de son périmètre.
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
    values (v_club,'ZZ Seniors 1', v_autre_team,'ZZ Adversaire Autre', current_date + 4, '20:00');
  -- L'ancien chemin, sans team_id : le nom doit encore suffire.
  insert into club_matches (club_id, team, opponent, match_date, kickoff_time)
    values (v_club,'ZZ U18 R3','ZZ Adversaire Par Le Nom', current_date + 5, '14:00');
  insert into club_calendar_events (club_id, title, type, event_date, event_time, team, team_id)
    values (v_club,'ZZ Entrainement Federation','entrainement', current_date + 2, '18:30', 'ZZ U18 1', v_team);

  -- ══ 1. LE JOUEUR VOIT SON MATCH ══════════════════════════════════════════
  perform pg_temp.incarner(v_joueur);
  select count(*) into n from club_matches where club_id = v_club and opponent = 'ZZ Adversaire Federation';
  if n <> 1 then e := e || array['le joueur ne voit pas le match rattaché à son équipe par team_id']; end if;

  -- ══ 2. LE MATCH D'UNE AUTRE ÉQUIPE RESTE FERMÉ ═══════════════════════════
  select count(*) into n from club_matches where club_id = v_club and opponent = 'ZZ Adversaire Autre';
  if n <> 0 then e := e || array['le joueur voit le match d''une autre équipe du club']; end if;

  -- ══ 3. L'ANCIEN CHEMIN PAR LE NOM TIENT TOUJOURS ═════════════════════════
  select count(*) into n from club_matches where club_id = v_club and opponent = 'ZZ Adversaire Par Le Nom';
  if n <> 1 then e := e || array['le match sans team_id, rattaché par le nom, n''est plus visible']; end if;

  -- ══ 4. L'ENTRAÎNEMENT REMONTE AUSSI ══════════════════════════════════════
  select count(*) into n from club_calendar_events where club_id = v_club and title = 'ZZ Entrainement Federation';
  if n <> 1 then e := e || array['le joueur ne voit pas l''entraînement rattaché par team_id']; end if;

  -- ══ 5. LE PARENT CONFIRMÉ VOIT LA MÊME CHOSE ═════════════════════════════
  perform pg_temp.incarner(v_parent);
  select count(*) into n from club_matches where club_id = v_club and opponent = 'ZZ Adversaire Federation';
  if n <> 1 then e := e || array['le parent confirmé ne voit pas le match de son enfant']; end if;
  select count(*) into n from club_matches where club_id = v_club and opponent = 'ZZ Adversaire Autre';
  if n <> 0 then e := e || array['le parent voit le match d''une autre équipe du club']; end if;

  perform pg_temp.serveur();
  if array_length(e,1) is null then
    raise notice '6/6 vérifications passées.';
  else
    raise exception 'ÉCHECS : %', array_to_string(e, ' | ');
  end if;
end $$;

rollback;
