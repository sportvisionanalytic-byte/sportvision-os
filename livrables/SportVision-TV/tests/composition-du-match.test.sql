-- La composition d'un match : le coach décide, le joueur ne la voit pas (v242, 21/09/2026).
--
-- DEMANDE DE FOUKA : « s'il y a un match à venir, qu'il puisse mettre la composition en avance.
-- Les joueurs ne doivent pas la voir, mais moi, community manager, je dois pouvoir voir la
-- composition ou alors les 14 convoqués. »
--
-- CE QU'ON MESURE :
--   1. Le coach de l'équipe compose son match.
--   2. Recomposer remplace le groupe, il ne s'y ajoute pas.
--   3. Le coach d'une AUTRE équipe ne compose pas à sa place.
--   4. Le président du club compose aussi.
--   5. Le CM SportVision LIT la composition, mais ne l'écrit pas.
--   6. Le JOUEUR CONVOQUÉ LUI-MÊME ne voit rien, ni par la fonction, ni par la table.
--   7. Le parent non plus.
--   8. Le compte des convoqués remonte pour tout le club en une fois.
--
-- Le point 6 est la raison d'être de ce test. Tout le reste peut se corriger un autre jour ; une
-- composition qui fuite vers le vestiaire, elle, ne se rattrape pas.

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
  v_coachA uuid; v_coachB uuid; v_pres uuid; v_cm uuid; v_joueur uuid; v_parent uuid;
  v_client uuid; v_club uuid; v_teamA uuid; v_teamB uuid; v_match uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_pf uuid;
  n int; e text[] := '{}';
begin
  perform pg_temp.serveur();

  v_coachA := gen_random_uuid(); v_coachB := gen_random_uuid(); v_pres := gen_random_uuid();
  v_cm := gen_random_uuid(); v_joueur := gen_random_uuid(); v_parent := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_coachA,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-compo-coacha@example.invalid','',now(),now(),now()),
    (v_coachB,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-compo-coachb@example.invalid','',now(),now(),now()),
    (v_pres,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-compo-pres@example.invalid','',now(),now(),now()),
    (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-compo-cm@example.invalid','',now(),now(),now()),
    (v_joueur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-compo-joueur@example.invalid','',now(),now(),now()),
    (v_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-compo-parent@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values
    (v_cm,'ZZ','CmCompo','zz-compo-cm@example.invalid','cm',true);

  insert into clients (nom, statut, cm_id) values ('ZZ Client Compo','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Compo','performance', v_client) returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ Compo A') returning id into v_teamA;
  insert into club_teams (club_id, name) values (v_club,'ZZ Compo B') returning id into v_teamB;

  insert into club_members (club_id, user_id, role, status, teams) values
    (v_club, v_coachA, 'coach', 'actif', '["ZZ Compo A"]'::jsonb),
    (v_club, v_coachB, 'coach', 'actif', '["ZZ Compo B"]'::jsonb),
    (v_club, v_pres,   'president', 'actif', '[]'::jsonb);

  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
    values (v_club,'ZZ Compo A', v_teamA,'ZZ Adversaire Compo', current_date + 4, '15:00')
    returning id into v_match;

  -- Trois joueurs, dont un relié à un vrai compte Connect : c'est lui qui ne doit rien voir.
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, v_joueur, 'ZZ','Titulaire','2000-01-01','actif') returning id into v_p1;
  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values (v_club, 'ZZ','Remplacant','2000-02-02','actif') returning id into v_p2;
  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values (v_club, 'ZZ','Reserve','2000-03-03','actif') returning id into v_p3;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_p1, v_teamA, v_club, '2026-2027', 'active'), (v_p2, v_teamA, v_club, '2026-2027', 'active'), (v_p3, v_teamA, v_club, '2026-2027', 'active');

  insert into parent_profiles (user_id, prenom, nom) values (v_parent,'ZZ','ParentCompo') returning id into v_pf;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
    values (v_pf, v_p2, 'parent', 'confirme', now());

  -- ══ 3. LE COACH DE L'AUTRE ÉQUIPE ════════════════════════════════════════
  perform pg_temp.incarner(v_coachB);
  if peut_composer_match(v_match) then e := e || 'le coach d''une autre equipe peut composer'::text; end if;
  begin
    perform match_composer(v_match, jsonb_build_array(jsonb_build_object('player_id', v_p1)));
    e := e || 'la composition par un coach etranger a ete acceptee'::text;
  exception when others then null; end;

  -- ══ 1. LE COACH COMPOSE ══════════════════════════════════════════════════
  perform pg_temp.incarner(v_coachA);
  if not peut_composer_match(v_match) then e := e || 'le coach de l''equipe ne peut pas composer'::text; end if;
  perform match_composer(v_match, jsonb_build_array(
    jsonb_build_object('player_id', v_p1, 'role','titulaire','poste','Milieu','ordre',1),
    jsonb_build_object('player_id', v_p2, 'role','remplacant','ordre',2),
    jsonb_build_object('player_id', v_p3, 'role','reserve','ordre',3)));
  select count(*) into n from match_composition(v_match);
  if n <> 3 then e := e || format('la composition devrait tenir 3 joueurs, elle en tient %s', n); end if;
  select count(*) into n from match_composition(v_match) where role = 'titulaire';
  if n <> 1 then e := e || 'le titulaire n''est pas enregistre comme tel'::text; end if;

  -- ══ 2. RECOMPOSER REMPLACE ═══════════════════════════════════════════════
  perform match_composer(v_match, jsonb_build_array(
    jsonb_build_object('player_id', v_p2, 'role','titulaire','ordre',1)));
  select count(*) into n from match_composition(v_match);
  if n <> 1 then e := e || format('recomposer aurait du remplacer le groupe, il en reste %s', n); end if;

  -- ══ 4. LE PRÉSIDENT COMPOSE AUSSI ════════════════════════════════════════
  perform pg_temp.incarner(v_pres);
  if not peut_composer_match(v_match) then e := e || 'le president ne peut pas composer'::text; end if;
  perform match_composer(v_match, jsonb_build_array(
    jsonb_build_object('player_id', v_p1, 'role','titulaire','ordre',1),
    jsonb_build_object('player_id', v_p2, 'role','remplacant','ordre',2)));

  -- ══ 5. LE CM SPORTVISION LIT, N'ÉCRIT PAS ════════════════════════════════
  perform pg_temp.incarner(v_cm);
  select count(*) into n from match_composition(v_match);
  if n <> 2 then e := e || format('le CM SportVision ne lit pas la composition (%s lignes)', n); end if;
  if peut_composer_match(v_match) then e := e || 'le CM SportVision peut composer a la place du coach'::text; end if;
  begin
    perform match_composer(v_match, jsonb_build_array(jsonb_build_object('player_id', v_p3)));
    e := e || 'le CM SportVision a pu ecrire la composition'::text;
  exception when others then null; end;

  -- ══ 6. LE JOUEUR CONVOQUÉ NE VOIT RIEN ═══════════════════════════════════
  perform pg_temp.incarner(v_joueur);
  select count(*) into n from match_convocations where match_id = v_match;
  if n <> 0 then e := e || format('LE JOUEUR VOIT LA COMPOSITION EN TABLE (%s lignes)', n); end if;
  begin
    select count(*) into n from match_composition(v_match);
    if n <> 0 then e := e || format('LE JOUEUR VOIT LA COMPOSITION PAR LA FONCTION (%s lignes)', n); end if;
  exception when others then null; end;

  -- ══ 7. LE PARENT NON PLUS ════════════════════════════════════════════════
  perform pg_temp.incarner(v_parent);
  select count(*) into n from match_convocations where match_id = v_match;
  if n <> 0 then e := e || format('LE PARENT VOIT LA COMPOSITION (%s lignes)', n); end if;

  -- ══ 8. LE COMPTE POUR TOUT LE CLUB ═══════════════════════════════════════
  perform pg_temp.incarner(v_coachA);
  select total into n from matchs_convocations_compte(v_club) where match_id = v_match;
  if coalesce(n,0) <> 2 then e := e || format('le compte des convoques est faux : %s', coalesce(n,-1)); end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le coach compose, le président aussi, SportVision lit sans écrire, et ni le joueur convoqué ni son parent ne voient quoi que ce soit.' as verdict;
rollback;
