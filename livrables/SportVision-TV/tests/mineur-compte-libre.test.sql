-- Un mineur crée son compte et rejoint son équipe comme un majeur (v217, 14/09/2026).
--
-- LA DÉCISION DE FOUKA : « le mineur peut créer son compte comme il veut, comme si c'était un
-- majeur, sans autorisation. Ensuite, un parent peut créer un compte pour lui et rattacher son
-- enfant qui a son compte. Ou alors un parent peut créer un compte et déclarer un enfant, mais qui
-- n'a pas de compte. »
--
-- POURQUOI CE FICHIER. Trois verrous, à trois endroits, interdisaient le premier chemin : un refus
-- explicite avant 14 ans, une demande qui démarrait en `en_attente_parent` sans jamais atteindre le
-- club, et trois autorisations parentales exigées à la validation. Une règle levée sans test se
-- remet toute seule à la première réécriture de fonction.
--
-- CE QU'ON MESURE :
--   1. Un enfant de 9 ans crée son profil joueur et sa demande, sans autorisation.
--   2. Sa demande arrive à `a_verifier` : devant le club, comme celle d'un majeur.
--   3. Le club la valide, sans autorisation signée, et l'affiliation existe vraiment.
--   4. Les autorisations restent PRÉPARÉES pour lui : le parent qui arrivera les trouve prêtes.
--   5. Un code d'équipe valide son adhésion d'emblée, même pour un mineur.
--   6. Ce qui n'a pas changé : un compte déjà rattaché à un autre club est toujours refusé.

begin;

create or replace function pg_temp.incarner(p uuid, mail text) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated','email',mail)::text, true);
end $i$;

create or replace function pg_temp.serveur() returns void language plpgsql as $i$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
end $i$;

do $$
declare
  v_club uuid; v_equipe uuid; v_equipe2 uuid; v_admin uuid;
  v_enfant uuid; v_mail text := 'zz-mineur@example.invalid';
  v_req membership_requests; v_code text;
  e text[] := '{}'; n int; st text;
begin
  perform pg_temp.serveur();

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut)
    values (v_club,'club','ZZ Club Mineur','actif_standard');
  insert into clubs (id, nom, plan, membership_validation_mode) values (v_club,'ZZ Club Mineur','performance','standard');
  insert into club_teams (club_id, name) values (v_club,'ZZ Min U10') returning id into v_equipe;
  insert into club_teams (club_id, name) values (v_club,'ZZ Min U11') returning id into v_equipe2;

  v_admin := gen_random_uuid(); v_enfant := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-min-admin@example.invalid','',now(),now(),now()),
      (v_enfant,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_mail,'',now(),now(),now());
  insert into club_members (club_id, user_id, role, status) values (v_club, v_admin, 'admin', 'actif');

  -- ══ 1. NEUF ANS, ET ÇA PASSE ═════════════════════════════════════════════
  perform pg_temp.incarner(v_enfant, v_mail);
  begin
    v_req := request_team_membership_as_player(
      v_club, v_equipe, null, 'ZZ', 'Mineur', (current_date - interval '9 years')::date);
  exception when others then
    e := e || ('un enfant de 9 ans ne peut pas demander — '||left(sqlerrm,90))::text;
  end;

  perform pg_temp.serveur();
  select count(*) into n from player_profiles where user_id = v_enfant;
  if n <> 1 then e := e || format('profil joueur : %s au lieu de 1', n); end if;

  -- ══ 2. SA DEMANDE ARRIVE DEVANT LE CLUB ══════════════════════════════════
  select statut into st from membership_requests where id = v_req.id;
  if st is distinct from 'a_verifier' then
    e := e || format('la demande demarre a %s au lieu de a_verifier', coalesce(st,'(nulle)'));
  end if;

  -- ══ 3. LE CLUB VALIDE, SANS AUTORISATION SIGNÉE ══════════════════════════
  select count(*) into n from parental_authorizations pa
    join authorization_types at2 on at2.id = pa.authorization_type_id
   where pa.player_id = v_req.player_id and pa.statut = 'valide';
  if n <> 0 then e := e || format('le decor a deja %s autorisation(s) signee(s) : le test ne prouverait rien', n); end if;

  perform pg_temp.incarner(v_admin, 'zz-min-admin@example.invalid');
  begin
    perform validate_team_membership(v_req.id);
  exception when others then
    e := e || ('la validation echoue sans autorisation — '||left(sqlerrm,90))::text;
  end;

  perform pg_temp.serveur();
  select statut into st from membership_requests where id = v_req.id;
  if st is distinct from 'validee' then e := e || format('apres validation, statut = %s', coalesce(st,'(nul)')); end if;
  select count(*) into n from team_memberships where player_id = v_req.player_id and team_id = v_equipe and statut = 'active';
  if n <> 1 then e := e || format('affiliation : %s au lieu de 1', n); end if;

  -- ══ 4. LES AUTORISATIONS RESTENT PRÉPARÉES ═══════════════════════════════
  -- Elles ne bloquent plus, mais le parent qui rejoindra doit les trouver prêtes à signer.
  select count(*) into n from parental_authorizations where player_id = v_req.player_id;
  if n = 0 then e := e || 'aucune autorisation preparee : le parent n aura rien a signer'::text; end if;

  -- ══ 5. UN CODE D'ÉQUIPE VALIDE D'EMBLÉE, MINEUR COMPRIS ══════════════════
  declare v_enfant2 uuid; v_mail2 text := 'zz-mineur2@example.invalid'; v_req2 membership_requests;
  begin
    v_code := 'ZZ-MIN-' || substr(gen_random_uuid()::text, 1, 8);
    insert into team_invite_codes (club_id, team_id, code, actif) values (v_club, v_equipe2, v_code, true);
    v_enfant2 := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_enfant2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_mail2,'',now(),now(),now());
    perform pg_temp.incarner(v_enfant2, v_mail2);
    v_req2 := request_team_membership_as_player(
      v_club, v_equipe2, v_code, 'ZZ', 'Mineur2', (current_date - interval '8 years')::date);
    perform pg_temp.serveur();
    select statut into st from membership_requests where id = v_req2.id;
    if st is distinct from 'validee' then
      e := e || format('par code, un mineur reste a %s au lieu de validee', coalesce(st,'(nul)'));
    end if;
  end;

  -- ══ 6. CE QUI N'A PAS CHANGÉ ═════════════════════════════════════════════
  declare v_autreclub uuid; msg text;
  begin
    v_autreclub := gen_random_uuid();
    insert into organizations (id, organization_type, nom, statut) values (v_autreclub,'club','ZZ Club Voisin','actif_standard');
    insert into clubs (id, nom, plan) values (v_autreclub,'ZZ Club Voisin','performance');
    perform pg_temp.incarner(v_enfant, v_mail);
    msg := null;
    begin
      perform request_team_membership_as_player(v_autreclub, null, null, 'ZZ', 'Mineur', (current_date - interval '9 years')::date);
      e := e || 'un compte deja rattache a un club a pu en demander un autre'::text;
    exception when others then msg := sqlerrm;
    end;
    if msg is null or msg not like '%autre club%' then
      e := e || ('le refus de double club n est plus explicite : '||coalesce(left(msg,70),'(aucun)'))::text;
    end if;
  end;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un enfant de 9 ans crée son compte, sa demande arrive devant le club, la validation aboutit sans autorisation signée ; les autorisations restent préparées pour le parent ; un code d''équipe valide d''emblée ; un compte déjà rattaché reste refusé ailleurs.' as verdict;

rollback;
