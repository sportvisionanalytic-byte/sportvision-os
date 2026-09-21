-- Un joueur rattaché à son équipe voit ses galeries (v248, 21/09/2026).
--
-- LE DÉFAUT : les trois fonctions de rattachement écrivaient la saison en TEXTE mais jamais son
-- identifiant. L'espace Photos du joueur, lui, exige club + équipe + saison. Un joueur fraîchement
-- validé se voyait donc répondre « Rejoignez votre club et votre équipe » — ce qu'il venait de
-- faire — sans aucune galerie ni Pass Photo. Personne ne l'avait vu : aucun joueur réel n'était
-- encore rattaché, et les seules lignes existantes avaient été créées à la main.
--
-- CE QU'ON MESURE :
--   1. La validation d'une demande pose la saison.
--   2. Plus aucune ligne active ne reste sans saison en production.
--   3. saison_id_pour reconnaît un libellé, et retombe sur la saison active sinon.

do $$
declare n int; e text[] := '{}';
begin
  select count(*) into n from team_memberships where statut = 'active' and saison_id is null;
  if n > 0 then e := e || format('%s rattachement(s) actif(s) sans saison', n); end if;

  if saison_id_pour('2026-2027') is null then e := e || 'saison_id_pour ne reconnait pas un libelle connu'::text; end if;
  if saison_id_pour('saison-qui-n-existe-pas') is null then e := e || 'saison_id_pour ne retombe pas sur la saison active'::text; end if;
  if saison_id_pour(null) is null then e := e || 'saison_id_pour(null) ne rend rien'::text; end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

-- Le parcours réel, dans une transaction annulée : une demande validée doit porter la saison.
begin;
do $$
declare
  v_cm uuid; v_admin uuid; v_client uuid; v_club uuid; v_team uuid; v_player uuid; v_req uuid; v_saison uuid; e text[] := '{}';
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-saison-cm@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values (v_cm,'ZZ','SaisonCm','zz-saison-cm@example.invalid','cm',true);
  insert into clients (nom, statut, cm_id) values ('ZZ Client Saison','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id, saison) values ('ZZ Club Saison','performance', v_client, '2026-2027') returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ U15 Saison') returning id into v_team;
  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values (v_club,'ZZ','JoueurSaison','2011-01-01','actif') returning id into v_player;
  insert into membership_requests (club_id, team_id, player_id, source, statut, validation_mode)
    values (v_club, v_team, v_player, 'invitation', 'a_verifier', 'standard') returning id into v_req;

  -- La validation appartient au club : on l'incarne, comme dans la vraie vie.
  v_admin := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-saison-admin@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status, teams)
    values (v_club, v_admin, 'admin', 'actif', '[]'::jsonb);
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  perform validate_team_membership(v_req);

  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  select saison_id into v_saison from team_memberships where player_id = v_player and team_id = v_team;
  if v_saison is null then
    e := e || 'la validation cree un rattachement SANS saison : le joueur ne verra aucune galerie'::text;
  end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;
rollback;

select 'OK — la validation d''une demande pose la saison, et plus aucun rattachement actif n''en manque.' as verdict;
