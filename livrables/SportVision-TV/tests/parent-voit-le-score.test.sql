-- Le parent voit le résultat du match de son enfant (v243, 21/09/2026).
--
-- DEMANDE DE FOUKA, en naviguant dans l'espace parent : « qu'il puisse voir le calendrier, ses
-- entraînements, et voir les résultats ».
--
-- CE QUI MANQUAIT. Les matchs de l'enfant remontaient déjà depuis le 12/09, mais
-- connect_list_calendar_for_athletes ne renvoyait pas le score. L'écran ne pouvait donc pas
-- l'afficher, quel que soit le soin mis à la mise en page — et personne ne s'en apercevait en
-- lisant le code de l'écran, puisqu'il n'y avait rien à corriger côté écran.
--
-- CE QU'ON MESURE :
--   1. Le parent confirmé voit le match de son enfant, avec son score.
--   2. Un match à venir n'a pas de score inventé : la colonne reste vide.
--   3. Les entraînements remontent toujours, et sans score.
--   4. Un parent NON confirmé ne voit rien du tout.

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
  v_parent uuid; v_etranger uuid; v_cm uuid;
  v_client uuid; v_club uuid; v_team uuid; v_enfant uuid; v_pf uuid; v_pfe uuid;
  v_score text; n int; e text[] := '{}';
begin
  perform pg_temp.serveur();

  v_parent := gen_random_uuid(); v_etranger := gen_random_uuid(); v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-score-parent@example.invalid','',now(),now(),now()),
    (v_etranger,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-score-etranger@example.invalid','',now(),now(),now()),
    (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-score-cm@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values (v_cm,'ZZ','CmScore','zz-score-cm@example.invalid','cm',true);

  insert into clients (nom, statut, cm_id) values ('ZZ Client Score','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Score','performance', v_client) returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ U13 Score') returning id into v_team;

  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values (v_club,'ZZ','EnfantScore','2013-05-05','actif') returning id into v_enfant;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_enfant, v_team, v_club, '2026-2027', 'active');

  insert into parent_profiles (user_id, prenom, nom) values (v_parent,'ZZ','ParentScore') returning id into v_pf;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
    values (v_pf, v_enfant, 'parent', 'confirme', now());
  -- Un second parent, dont le lien n'est PAS confirmé : il ne doit rien voir.
  insert into parent_profiles (user_id, prenom, nom) values (v_etranger,'ZZ','ParentEnAttente') returning id into v_pfe;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
    values (v_pfe, v_enfant, 'parent', 'en_attente_confirmation');

  -- Un match joué avec son score, un match à venir sans, un entraînement.
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, score, sport_status, status)
    values (v_club,'ZZ U13 Score', v_team,'ZZ Adversaire Joue', current_date - 6, '10:00', '4 - 2', 'completed', 'recu');
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
    values (v_club,'ZZ U13 Score', v_team,'ZZ Adversaire A Venir', current_date + 5, '10:00');
  insert into club_calendar_events (club_id, title, type, event_date, event_time, team, team_id)
    values (v_club,'ZZ Entrainement Score','entrainement', current_date + 2, '17:30', 'ZZ U13 Score', v_team);

  -- ══ 1. LE SCORE REMONTE ══════════════════════════════════════════════════
  perform pg_temp.incarner(v_parent);
  select score into v_score from connect_list_calendar_for_athletes()
   where title ilike '%ZZ Adversaire Joue%' limit 1;
  if coalesce(v_score,'') <> '4 - 2' then
    e := e || format('le score du match joue ne remonte pas au parent : %s', coalesce(v_score,'RIEN'));
  end if;

  -- ══ 2. AUCUN SCORE INVENTÉ SUR UN MATCH À VENIR ══════════════════════════
  select score into v_score from connect_list_calendar_for_athletes()
   where title ilike '%ZZ Adversaire A Venir%' limit 1;
  if v_score is not null then
    e := e || format('un match a venir porte un score : %s', v_score);
  end if;

  -- ══ 3. LES ENTRAÎNEMENTS SONT TOUJOURS LÀ ════════════════════════════════
  select count(*) into n from connect_list_calendar_for_athletes() where title = 'ZZ Entrainement Score';
  if n <> 1 then e := e || format('l''entrainement ne remonte plus (%s ligne(s))', n); end if;

  -- ══ 4. UN LIEN NON CONFIRMÉ NE DONNE RIEN ════════════════════════════════
  perform pg_temp.incarner(v_etranger);
  select count(*) into n from connect_list_calendar_for_athletes();
  if n <> 0 then e := e || format('un parent non confirme voit %s evenement(s)', n); end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le parent voit le score du match joué, aucun score sur un match à venir, les entraînements intacts, et rien pour un lien non confirmé.' as verdict;
rollback;
