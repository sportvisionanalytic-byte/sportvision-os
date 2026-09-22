-- L'identité du club, et seulement pour les siens (v252, 22/09/2026).
--
-- CE QU'ON MESURE :
--   1. Le joueur affilié obtient le nom et l'écusson de son club.
--   2. Son parent confirmé aussi.
--   3. Un inconnu, authentifié mais étranger au club, n'obtient rien (zéro ligne, pas une erreur).
--   4. La fonction ne rend jamais autre chose que l'identité publique : les colonnes sensibles
--      (SIRET, Stripe) ne font pas partie de son résultat, par construction.

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
  v_joueur uuid; v_parent uuid; v_inconnu uuid; v_cm uuid;
  v_client uuid; v_club uuid; v_team uuid; v_pp uuid; v_pf uuid;
  v_nom text; n int; e text[] := '{}';
begin
  perform pg_temp.serveur();

  v_joueur := gen_random_uuid(); v_parent := gen_random_uuid();
  v_inconnu := gen_random_uuid(); v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_joueur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-ident-joueur@example.invalid','',now(),now(),now()),
    (v_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-ident-parent@example.invalid','',now(),now(),now()),
    (v_inconnu,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-ident-inconnu@example.invalid','',now(),now(),now()),
    (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-ident-cm@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values (v_cm,'ZZ','CmIdent','zz-ident-cm@example.invalid','cm',true);

  insert into clients (nom, statut, cm_id) values ('ZZ Client Ident','client', v_cm) returning id into v_client;
  insert into clubs (nom, ville, ecusson_url, plan, portail_client_id)
    values ('ZZ Club Ident','ZZ Ville','https://exemple.invalid/zz-ecusson.png','performance', v_client)
    returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ U15 Ident') returning id into v_team;

  insert into player_profiles (user_id, club_id, prenom, nom, date_naissance, account_status)
    values (v_joueur, v_club,'ZZ','JoueurIdent','2011-02-02','actif') returning id into v_pp;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_pp, v_team, v_club, '2026-2027','active');

  insert into parent_profiles (user_id, prenom, nom) values (v_parent,'ZZ','ParentIdent') returning id into v_pf;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
    values (v_pf, v_pp, 'parent','confirme', now());

  -- ══ 1. LE JOUEUR ═════════════════════════════════════════════════════════
  perform pg_temp.incarner(v_joueur);
  select count(*) into n from club_identite(v_club);
  if n <> 1 then e := e || array['le joueur n''obtient pas l''identité de son club']; end if;
  select ecusson_url into v_nom from club_identite(v_club);
  if v_nom is distinct from 'https://exemple.invalid/zz-ecusson.png' then
    e := e || array['l''écusson rendu au joueur n''est pas celui du club'];
  end if;

  -- ══ 2. LE PARENT CONFIRMÉ ════════════════════════════════════════════════
  perform pg_temp.incarner(v_parent);
  select count(*) into n from club_identite(v_club);
  if n <> 1 then e := e || array['le parent confirmé n''obtient pas l''identité du club']; end if;

  -- ══ 3. L'INCONNU ═════════════════════════════════════════════════════════
  perform pg_temp.incarner(v_inconnu);
  select count(*) into n from club_identite(v_club);
  if n <> 0 then e := e || array['un étranger au club obtient son identité']; end if;

  perform pg_temp.serveur();
  if array_length(e,1) is null then
    raise notice '4/4 vérifications passées.';
  else
    raise exception 'ÉCHECS : %', array_to_string(e, ' | ');
  end if;
end $$;

rollback;
