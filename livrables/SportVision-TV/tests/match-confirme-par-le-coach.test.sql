-- Le coach confirme que le match est au bon horaire, au bon endroit (v241, 21/09/2026).
--
-- DEMANDE DE FOUKA : « il y a eu pas mal d'erreurs sur les calendriers, des matchs qui n'étaient
-- pas bons. Les coachs doivent pouvoir confirmer si c'est la bonne horaire, le bon lieu, modifier
-- ou ajouter un match, comme ça moi sur le calendrier je vois le match exact. »
--
-- CE QU'ON MESURE :
--   1. Le coach de l'équipe confirme son match, et la confirmation porte son nom.
--   2. Il confirme EN corrigeant : l'horaire corrigé est enregistré du même geste.
--   3. La correction verrouille le champ contre la prochaine synchro fédérale (acquis v237).
--   4. Un coach d'une AUTRE équipe du même club ne confirme pas à sa place.
--   5. Le président et le secrétaire confirment n'importe quelle équipe du club.
--   6. Le CM SportVision, lui, ne confirme pas : il corrige, mais il ne signe pas pour le club.
--   7. Une synchro fédérale qui redéplace le match fait tomber la confirmation.
--   8. Une correction humaine, elle, ne la fait pas tomber : quelqu'un vient de regarder la ligne.
--   9. Le coach retire sa confirmation s'il a parlé trop vite.
--  10. matchs_a_confirmer ne remonte que ce qui reste à confirmer, et dit qui peut le faire.
--  11. Le coach AJOUTE un match sur son équipe, et pas sur celle d'à côté. Fouka a demandé les
--      deux gestes dans la même phrase : « qu'ils puissent modifier ou ajouter un match ». Le
--      droit existait déjà en base ; ce point garde qu'il existe toujours, et surtout que le
--      rattachement à l'équipe marche quand le coach ne donne QUE le nom de son équipe — c'est
--      ce que fait l'écran, et c'est un trigger qui résout l'identifiant derrière.

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
  v_coachA uuid; v_coachB uuid; v_pres uuid; v_sec uuid; v_cm uuid;
  v_client uuid; v_club uuid; v_teamA uuid; v_teamB uuid; v_match uuid;
  v_conf timestamptz; v_par uuid; v_heure time; v_verrous text[]; n int; e text[] := '{}';
begin
  perform pg_temp.serveur();

  v_coachA := gen_random_uuid(); v_coachB := gen_random_uuid();
  v_pres := gen_random_uuid(); v_sec := gen_random_uuid(); v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_coachA,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coach-a@example.invalid','',now(),now(),now()),
    (v_coachB,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coach-b@example.invalid','',now(),now(),now()),
    (v_pres,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-president@example.invalid','',now(),now(),now()),
    (v_sec,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-secretaire@example.invalid','',now(),now(),now()),
    (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cm-sv@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values
    (v_cm,'ZZ','CmSportVision','zz-cm-sv@example.invalid','cm',true);

  insert into clients (nom, statut, cm_id) values ('ZZ Client Confirm','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Confirm','performance', v_client) returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ U15 A') returning id into v_teamA;
  insert into club_teams (club_id, name) values (v_club,'ZZ U17 B') returning id into v_teamB;

  insert into club_members (club_id, user_id, role, status, teams) values
    (v_club, v_coachA, 'coach', 'actif', '["ZZ U15 A"]'::jsonb),
    (v_club, v_coachB, 'coach', 'actif', '["ZZ U17 B"]'::jsonb),
    (v_club, v_pres,   'president', 'actif', '[]'::jsonb),
    (v_club, v_sec,    'secretaire', 'actif', '[]'::jsonb);

  -- Un match de l'équipe A, venu de la fédération, à 14h au stade municipal.
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, provider, external_event_id)
    values (v_club,'ZZ U15 A', v_teamA,'ZZ Adversaire', current_date + 6, '14:00', 'ZZ Stade Municipal', 'SPORTCORICO', 'zz-ext-241')
    returning id into v_match;

  -- ══ 4. LE COACH DE L'AUTRE ÉQUIPE NE CONFIRME PAS ════════════════════════
  perform pg_temp.incarner(v_coachB);
  if peut_confirmer_match(v_match) then
    e := e || 'le coach d''une autre equipe peut confirmer ce match'::text;
  end if;
  begin
    perform match_confirmer(v_match);
    e := e || 'la confirmation par un coach etranger a l''equipe a ete acceptee'::text;
  exception when others then null; end;

  -- ══ 6. LE CM SPORTVISION NE SIGNE PAS POUR LE CLUB ═══════════════════════
  perform pg_temp.incarner(v_cm);
  if peut_confirmer_match(v_match) then
    e := e || 'le CM SportVision peut confirmer a la place du club'::text;
  end if;

  -- ══ 1. LE COACH DE L'ÉQUIPE CONFIRME ═════════════════════════════════════
  perform pg_temp.incarner(v_coachA);
  if not peut_confirmer_match(v_match) then
    e := e || 'le coach de l''equipe ne peut pas confirmer son propre match'::text;
  end if;
  perform match_confirmer(v_match);
  perform pg_temp.serveur();
  select horaire_confirme_par, horaire_confirme_le, champs_verrouilles
    into v_par, v_conf, v_verrous from club_matches where id = v_match;
  if v_conf is null then e := e || 'la confirmation n''a pas ete enregistree'::text; end if;
  if v_par is distinct from v_coachA then e := e || 'la confirmation ne porte pas le nom du coach'::text; end if;
  -- Confirmer sans rien changer ne verrouille rien : la fédération reste libre de corriger.
  if array_length(v_verrous,1) is not null then
    e := e || format('une confirmation sans correction a verrouille des champs : %s', array_to_string(v_verrous,','));
  end if;

  -- ══ 7. LA FÉDÉRATION REDÉPLACE, LA CONFIRMATION TOMBE ════════════════════
  -- auth.uid() nul : c'est la signature d'une synchronisation, pas d'un humain.
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update club_matches set kickoff_time = '16:00' where id = v_match;
  select horaire_confirme_le into v_conf from club_matches where id = v_match;
  if v_conf is not null then
    e := e || 'le match a ete redeplace mais reste marque confirme'::text;
  end if;

  -- ══ 2 & 3. IL CONFIRME EN CORRIGEANT ═════════════════════════════════════
  perform pg_temp.incarner(v_coachA);
  perform match_confirmer(v_match, null, '15:30'::time, 'ZZ Stade des Sports', null);
  perform pg_temp.serveur();
  select kickoff_time, horaire_confirme_le, champs_verrouilles
    into v_heure, v_conf, v_verrous from club_matches where id = v_match;
  if v_heure <> '15:30' then e := e || format('l''horaire corrige n''est pas enregistre : %s', v_heure); end if;
  if (select lieu from club_matches where id = v_match) <> 'ZZ Stade des Sports' then
    e := e || 'le lieu corrige n''est pas enregistre'::text;
  end if;
  if v_conf is null then e := e || 'la correction n''a pas valu confirmation'::text; end if;
  if not (v_verrous @> array['kickoff_time'] and v_verrous @> array['lieu']) then
    e := e || format('la correction du coach ne verrouille pas les champs : %s', coalesce(array_to_string(v_verrous,','),'aucun'));
  end if;

  -- ══ 8. UNE CORRECTION HUMAINE NE FAIT PAS TOMBER LA CONFIRMATION ═════════
  perform pg_temp.incarner(v_coachA);
  update club_matches set comment = 'ZZ terrain synthetique' where id = v_match;
  perform pg_temp.serveur();
  select horaire_confirme_le into v_conf from club_matches where id = v_match;
  if v_conf is null then
    e := e || 'une retouche humaine a fait tomber la confirmation'::text;
  end if;

  -- ══ 9. IL RETIRE SA CONFIRMATION ═════════════════════════════════════════
  perform pg_temp.incarner(v_coachA);
  perform match_confirmation_retirer(v_match);
  perform pg_temp.serveur();
  select horaire_confirme_le into v_conf from club_matches where id = v_match;
  if v_conf is not null then e := e || 'la confirmation retiree tient toujours'::text; end if;

  -- ══ 5. PRÉSIDENT ET SECRÉTAIRE, SUR TOUTE ÉQUIPE ═════════════════════════
  perform pg_temp.incarner(v_pres);
  if not peut_confirmer_match(v_match) then e := e || 'le president ne peut pas confirmer'::text; end if;
  perform pg_temp.incarner(v_sec);
  if not peut_confirmer_match(v_match) then e := e || 'le secretaire ne peut pas confirmer'::text; end if;
  perform match_confirmer(v_match);

  -- ══ 10. LA LISTE DE CE QUI RESTE À CONFIRMER ═════════════════════════════
  perform pg_temp.serveur();
  -- Un second match, non confirmé, sur l'équipe B.
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, lieu)
    values (v_club,'ZZ U17 B', v_teamB,'ZZ Autre Adversaire', current_date + 8, '10:00', 'ZZ Gymnase');
  -- Et un match annulé, qui n'a aucune raison d'être confirmé par qui que ce soit.
  insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, sport_status)
    values (v_club,'ZZ U15 A', v_teamA,'ZZ Match Annule', current_date + 9, '11:00', 'cancelled');

  perform pg_temp.incarner(v_coachB);
  select count(*) into n from matchs_a_confirmer(v_club);
  if n <> 1 then e := e || format('la liste a confirmer devrait tenir 1 match, elle en tient %s', n); end if;
  if not (select confirmable from matchs_a_confirmer(v_club) limit 1) then
    e := e || 'le coach B ne peut pas confirmer le match de sa propre equipe'::text;
  end if;

  -- Le coach A, lui, voit le même match à confirmer mais ne peut pas le signer.
  perform pg_temp.incarner(v_coachA);
  if (select confirmable from matchs_a_confirmer(v_club) limit 1) then
    e := e || 'le coach A peut signer un match de l''equipe B'::text;
  end if;

  -- ══ 11. IL AJOUTE UN MATCH ═══════════════════════════════════════════════
  perform pg_temp.incarner(v_coachA);
  begin
    insert into club_matches (club_id, team, opponent, match_date, kickoff_time, lieu)
      values (v_club, 'ZZ U15 A', 'ZZ Match Ajoute', current_date + 10, '16:00', 'ZZ Stade Ajoute');
  exception when others then
    e := e || format('le coach ne peut pas ajouter un match a son equipe : %s', sqlerrm);
  end;
  perform pg_temp.serveur();
  select count(*) into n from club_matches where club_id = v_club and opponent = 'ZZ Match Ajoute';
  if n <> 1 then e := e || 'le match ajoute par le coach n''existe pas'::text; end if;
  -- Le rattachement doit s'etre fait tout seul a partir du seul nom d'equipe.
  if (select team_id from club_matches where opponent = 'ZZ Match Ajoute') is distinct from v_teamA then
    e := e || 'le match ajoute n''est pas rattache a l''equipe du coach'::text;
  end if;

  -- Et pas sur l'equipe d'a cote.
  perform pg_temp.incarner(v_coachA);
  begin
    insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
      values (v_club, 'ZZ U17 B', v_teamB, 'ZZ Match Interdit', current_date + 11, '17:00');
    e := e || 'le coach a ajoute un match sur l''equipe d''un collegue'::text;
  exception when others then null; end;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le coach confirme son match, corrige du même geste, la correction résiste à la fédération, et une confirmation ne survit pas à un redéplacement.' as verdict;
rollback;
