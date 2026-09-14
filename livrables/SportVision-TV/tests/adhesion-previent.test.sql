-- Une demande d'adhésion prévient le club, et la réponse revient au demandeur (v212, 13/09/2026).
--
-- POURQUOI CE FICHIER (14/09/2026). C'est le parcours par lequel arriveront TOUS les joueurs des
-- clubs : la famille demande, le club valide. Deux silences avaient été mesurés en base avant la
-- v212 — aucun déclencheur sur `membership_requests`, et `validate_team_membership` n'écrivait
-- aucune notification. Une demande attendait donc qu'un dirigeant pense à ouvrir l'écran des
-- affiliations, et l'écran de Connect promettait « vous serez prévenu » à quelqu'un que personne ne
-- prévenait. Ces deux silences se paient en appels téléphoniques.
--
-- CE QU'ON MESURE :
--   1. L'administration du club est prévenue, et l'éducateur de l'équipe visée aussi.
--   2. Un coach d'une AUTRE équipe ne l'est pas : une notification est une sollicitation, pas une
--      information à diffuser largement.
--   3. La validation prévient le demandeur ; le refus aussi, et les deux messages diffèrent.
--   4. Rien ne part quand le statut ne change pas (une mise à jour de forme ne réveille personne).
--   5. Une demande sans compte demandeur (saisie par le club) ne casse rien.

begin;

do $$
declare
  v_org uuid; v_club uuid; v_equipe uuid; v_autre uuid;
  v_admin uuid; v_coach uuid; v_coach_autre uuid; v_demandeur uuid;
  v_joueur uuid; v_demande uuid;
  e text[] := '{}'; n int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  v_org := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut)
    values (v_org,'club','ZZ Club Adhesion','actif_standard');
  insert into clubs (id, nom, plan) values (v_org,'ZZ Club Adhesion','performance');
  v_club := v_org;
  insert into club_teams (club_id, name) values (v_club,'ZZ Adh U13 A') returning id into v_equipe;
  insert into club_teams (club_id, name) values (v_club,'ZZ Adh U15 B') returning id into v_autre;

  v_admin := gen_random_uuid(); v_coach := gen_random_uuid();
  v_coach_autre := gen_random_uuid(); v_demandeur := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-adh-admin@example.invalid','',now(),now(),now()),
      (v_coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-adh-coach@example.invalid','',now(),now(),now()),
      (v_coach_autre,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-adh-coach2@example.invalid','',now(),now(),now()),
      (v_demandeur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-adh-famille@example.invalid','',now(),now(),now());

  insert into club_members (club_id, user_id, role, status, teams) values
    (v_club, v_admin, 'admin', 'actif', '[]'::jsonb),
    (v_club, v_coach, 'coach', 'actif', to_jsonb(array['ZZ Adh U13 A'])),
    (v_club, v_coach_autre, 'coach', 'actif', to_jsonb(array['ZZ Adh U15 B']));

  insert into player_profiles (prenom, nom, club_id, date_naissance)
    values ('ZZ','Adhesion', v_club, date '2013-04-04') returning id into v_joueur;

  -- ══ 1. LA DEMANDE PRÉVIENT CEUX QUI PEUVENT LA TRAITER ════════════════════
  insert into membership_requests (club_id, team_id, player_id, requested_by_user_id, source, statut)
    values (v_club, v_equipe, v_joueur, v_demandeur, 'spontanee', 'a_verifier')
    returning id into v_demande;

  select count(*) into n from member_notifications
   where user_id = v_admin and title = 'Nouvelle demande d''adhésion';
  if n <> 1 then e := e || format('administration : %s notification au lieu de 1', n); end if;

  select count(*) into n from member_notifications
   where user_id = v_coach and title = 'Nouvelle demande d''adhésion';
  if n <> 1 then e := e || format('educateur de l equipe : %s notification au lieu de 1', n); end if;

  -- ══ 2. PAS LE COACH D'UNE AUTRE ÉQUIPE ════════════════════════════════════
  select count(*) into n from member_notifications where user_id = v_coach_autre;
  if n <> 0 then e := e || format('un coach d une autre equipe recoit %s notification(s)', n); end if;

  -- Le message dit QUI demande et OÙ : sans cela, il faut ouvrir l'écran pour le savoir.
  select count(*) into n from member_notifications
   where user_id = v_coach and body like '%ZZ Adhesion%' and body like '%ZZ Adh U13 A%';
  if n <> 1 then e := e || 'le message ne nomme pas le joueur et son equipe'::text; end if;

  -- ══ 3. UNE MISE À JOUR SANS CHANGEMENT DE STATUT NE RÉVEILLE PERSONNE ═════
  update membership_requests set updated_at = now() where id = v_demande;
  select count(*) into n from member_notifications where user_id = v_demandeur;
  if n <> 0 then e := e || format('une mise a jour de forme a envoye %s notification(s)', n); end if;

  -- ══ 4. LA VALIDATION REVIENT AU DEMANDEUR ════════════════════════════════
  update membership_requests set statut = 'validee' where id = v_demande;
  select count(*) into n from member_notifications
   where user_id = v_demandeur and title = 'Adhésion acceptée' and body like '%ZZ Adh U13 A%';
  if n <> 1 then e := e || 'le demandeur n est pas prevenu de l acceptation'::text; end if;

  -- ══ 5. LE REFUS AUSSI, ET IL NE DIT PAS LA MÊME CHOSE ════════════════════
  declare v_demande2 uuid; begin
    insert into membership_requests (club_id, team_id, player_id, requested_by_user_id, source, statut)
      values (v_club, v_equipe, v_joueur, v_demandeur, 'spontanee', 'a_verifier') returning id into v_demande2;
    update membership_requests set statut = 'refusee' where id = v_demande2;
    select count(*) into n from member_notifications
     where user_id = v_demandeur and title = 'Adhésion refusée';
    if n <> 1 then e := e || 'le demandeur n est pas prevenu du refus'::text; end if;
    select count(*) into n from member_notifications
     where user_id = v_demandeur and title = 'Adhésion refusée' and body like '%accepté%';
    if n <> 0 then e := e || 'le refus reprend le texte de l acceptation'::text; end if;
  end;

  -- ══ 6. UNE DEMANDE SANS COMPTE DEMANDEUR NE CASSE RIEN ═══════════════════
  -- Le club peut saisir l'adhésion lui-même : il n'y a alors personne à prévenir en retour.
  declare v_demande3 uuid; begin
    insert into membership_requests (club_id, team_id, player_id, requested_by_user_id, source, statut)
      values (v_club, v_equipe, v_joueur, null, 'spontanee', 'a_verifier') returning id into v_demande3;
    begin
      update membership_requests set statut = 'validee' where id = v_demande3;
    exception when others then
      e := e || ('valider une demande sans demandeur echoue — '||left(sqlerrm,70))::text;
    end;
  end;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — la demande prévient l''administration et l''éducateur de l''équipe, eux seuls ; la réponse revient au demandeur, acceptation et refus distincts ; une mise à jour de forme ne réveille personne ; une demande sans compte ne casse rien.' as verdict;

rollback;
