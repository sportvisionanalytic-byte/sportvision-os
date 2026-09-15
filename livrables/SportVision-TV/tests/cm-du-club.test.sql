-- Le Community Manager DU CLUB construit le planning éditorial (v234, 15/09/2026).
--
-- DEMANDE DE FOUKA : « rajouter le rôle de Community Manager du club, il aura le même accès que le
-- Community Manager affilié ». Avec trois limites qu'il a posées lui-même : rôle distinct de celui
-- du CM SportVision, ni l'argent ni les accès, et sur les galeries il voit et partage sans fixer
-- de prix.
--
-- CE QU'ON MESURE :
--   1. Il crée un contenu dans le planning de SON club.
--   2. Le contenu porte le CM SportVision référent, et dit que c'est LUI qui l'a écrit.
--   3. Il le modifie et le supprime tant qu'il n'est pas publié.
--   4. Un contenu publié ne se supprime plus.
--   5. Il ne touche pas au planning d'un AUTRE club.
--   6. Il ne fixe aucun prix de galerie.
--   7. Un simple coach du même club n'écrit rien : c'est un rôle, pas l'appartenance au club.
--   8. Sans CM SportVision référent, le refus explique quoi faire.
--   9. Il travaille le club : calendrier, matchs, actualités.
--  10. Et il ne voit ni l'argent, ni les gens : montants, sponsors, annuaire, invitations.
--
-- Le point 10 n'est pas une précaution de style. Ma première version (v235) ajoutait ce rôle à
-- `peut_operer_club`, la fonction qui dit « travaille sur ce club » — et cette seule fonction
-- gouvernait aussi les montants des réservations, les sponsors et l'annuaire. Le rôle s'est
-- retrouvé à lire exactement les deux choses que Fouka avait exclues. La v236 sépare « travailler »
-- de « administrer » ; ce test garde la frontière.

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
  v_cm uuid; v_cmclub uuid; v_coach uuid;
  v_client uuid; v_club uuid; v_client2 uuid; v_club2 uuid; v_client3 uuid; v_club3 uuid;
  c1 uuid; c2 uuid; n int; msg text; st text; e text[] := '{}';
begin
  perform pg_temp.serveur();

  -- Un CM SportVision référent, un CM du club, un coach du même club.
  v_cm := gen_random_uuid(); v_cmclub := gen_random_uuid(); v_coach := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cmsv@example.invalid','',now(),now(),now()),
    (v_cmclub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cmclub@example.invalid','',now(),now(),now()),
    (v_coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coachclub@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values
    (v_cm,'ZZ','CmSportVision','zz-cmsv@example.invalid','cm',true);

  insert into clients (nom, statut, cm_id) values ('ZZ Client CMClub','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club CMClub','performance', v_client) returning id into v_club;
  insert into clients (nom, statut, cm_id) values ('ZZ Client Voisin','client', v_cm) returning id into v_client2;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Voisin','performance', v_client2) returning id into v_club2;
  -- Un troisième club, SANS CM référent : le cas du refus explicite.
  insert into clients (nom, statut) values ('ZZ Client Sans CM','client') returning id into v_client3;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Sans CM','performance', v_client3) returning id into v_club3;

  insert into club_members (club_id, user_id, role, status, teams) values
    (v_club, v_cmclub, 'comm', 'actif', '[]'::jsonb),
    (v_club, v_coach, 'coach', 'actif', '[]'::jsonb),
    (v_club3, v_cmclub, 'comm', 'actif', '[]'::jsonb);

  -- ══ 1 & 2. IL ÉCRIT, ET ON SAIT QUI A ÉCRIT ══════════════════════════════
  perform pg_temp.incarner(v_cmclub);
  begin
    -- L'ecran envoie l'identifiant de celui qui saisit comme cm_id : pour un membre du club, ce
    -- n'est pas un profil SportVision. Le trigger doit le corriger, pas refuser.
    insert into contenus (client_id, cm_id, titre, statut, type_contenu)
      values (v_client, v_cmclub, 'ZZ Matchday du club', 'brouillon', 'publication') returning id into c1;
  exception when others then
    e := e || ('le CM du club ne peut pas creer de contenu — '||left(sqlerrm,90))::text;
  end;
  perform pg_temp.serveur();
  if c1 is null then
    e := e || 'aucun contenu cree'::text;
  else
    select cm_id, auteur_club_user_id into st, msg from contenus where id = c1;
    if st is distinct from v_cm::text then e := e || format('cm_id attendu le referent, obtenu %s', st); end if;
    if msg is distinct from v_cmclub::text then e := e || 'l auteur du club n est pas trace'::text; end if;
  end if;

  -- ══ 3. IL MODIFIE ET SUPPRIME ════════════════════════════════════════════
  perform pg_temp.incarner(v_cmclub);
  update contenus set titre = 'ZZ Matchday du club (repris)' where id = c1;
  perform pg_temp.serveur();
  if (select titre from contenus where id = c1) <> 'ZZ Matchday du club (repris)' then
    e := e || 'le CM du club ne peut pas modifier son contenu'::text;
  end if;

  insert into contenus (client_id, cm_id, titre, statut, type_contenu)
    values (v_client, v_cm, 'ZZ A supprimer', 'brouillon', 'publication') returning id into c2;
  perform pg_temp.incarner(v_cmclub);
  delete from contenus where id = c2;
  perform pg_temp.serveur();
  if exists (select 1 from contenus where id = c2) then
    e := e || 'le CM du club ne peut pas supprimer un brouillon'::text;
  end if;

  -- ══ 4. RIEN DE PUBLIÉ NE SE SUPPRIME ═════════════════════════════════════
  insert into contenus (client_id, cm_id, titre, statut, type_contenu)
    values (v_client, v_cm, 'ZZ Publie', 'publie', 'publication') returning id into c2;
  perform pg_temp.incarner(v_cmclub);
  delete from contenus where id = c2;
  perform pg_temp.serveur();
  if not exists (select 1 from contenus where id = c2) then
    e := e || 'un contenu publie a ete supprime par le club'::text;
  end if;

  -- ══ 5. PAS LE PLANNING DU VOISIN ═════════════════════════════════════════
  perform pg_temp.incarner(v_cmclub);
  begin
    insert into contenus (client_id, titre, statut, type_contenu)
      values (v_client2, 'ZZ Intrus', 'brouillon', 'publication');
    e := e || 'le CM d un club a ecrit dans le planning d un autre club'::text;
  exception when others then null;
  end;

  -- ══ 6. AUCUN PRIX DE GALERIE ═════════════════════════════════════════════
  if media_pricing_staff_album((select gen_random_uuid())) then
    e := e || 'le CM du club fixe des prix de galerie'::text;
  end if;

  -- ══ 7. LE COACH DU MÊME CLUB N'ÉCRIT PAS ═════════════════════════════════
  perform pg_temp.incarner(v_coach);
  begin
    insert into contenus (client_id, titre, statut, type_contenu)
      values (v_client, 'ZZ Coach', 'brouillon', 'publication');
    e := e || 'un coach a ecrit dans le planning editorial'::text;
  exception when others then null;
  end;

  -- ══ 8. SANS CM RÉFÉRENT, LE REFUS EXPLIQUE ═══════════════════════════════
  perform pg_temp.incarner(v_cmclub);
  msg := null;
  begin
    insert into contenus (client_id, titre, statut, type_contenu)
      values (v_client3, 'ZZ Sans referent', 'brouillon', 'publication');
    e := e || 'un contenu a ete cree sans CM referent'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%référent%' then
    e := e || ('le refus sans referent n explique rien : '||coalesce(left(msg,70),'(aucun)'))::text;
  end if;

  -- ══ 9. IL TRAVAILLE LE CLUB ══════════════════════════════════════════════
  perform pg_temp.serveur();
  declare v_team uuid; v_ev uuid; v_match uuid; begin
    insert into club_teams (club_id, name) values (v_club,'ZZ U15') returning id into v_team;
    insert into club_calendar_events (club_id, title, type, event_date, team, team_id)
      values (v_club,'ZZ Evenement','tournoi', current_date + 4, 'ZZ U15', v_team) returning id into v_ev;
    insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
      values (v_club,'ZZ U15', v_team,'ZZ Adversaire', current_date + 5, '15:00') returning id into v_match;
    perform pg_temp.incarner(v_cmclub);
    update club_calendar_events set title = 'ZZ Evenement repris' where id = v_ev;
    update club_matches set opponent = 'ZZ Adversaire repris' where id = v_match;
    perform pg_temp.serveur();
    if (select title from club_calendar_events where id = v_ev) <> 'ZZ Evenement repris' then
      e := e || 'le CM du club ne peut pas reprendre un evenement'::text;
    end if;
    if (select opponent from club_matches where id = v_match) <> 'ZZ Adversaire repris' then
      e := e || 'le CM du club ne peut pas reprendre un match'::text;
    end if;
    perform pg_temp.incarner(v_cmclub);
    begin
      insert into club_newsroom_items (club_id, title, type, status)
        values (v_club, 'ZZ Actu du club', 'Actualité', 'recu');
    exception when others then
      e := e || ('le CM du club ne peut pas ecrire une actualite — '||left(sqlerrm,60))::text;
    end;
  end;

  -- ══ 10. NI L'ARGENT, NI LES GENS ═════════════════════════════════════════
  perform pg_temp.serveur();
  insert into club_sponsors (club_id, name) values (v_club, 'ZZ Sponsor ferme');
  perform pg_temp.incarner(v_cmclub);
  select count(*) into n from club_sponsors where club_id = v_club;
  if n <> 0 then e := e || format('le CM du club lit %s sponsor(s)', n); end if;
  -- Savoir QUI est dans le club est normal pour un membre. L'ANNUAIRE, ce sont les coordonnees :
  -- c'est cette porte-la qui doit rester fermee (decision du 11/09), et elle a sa propre fonction.
  if peut_lire_annuaire_club(v_club) then
    e := e || 'le CM du club lit l annuaire du club (telephones, coordonnees)'::text;
  end if;
  select count(*) into n from club_invitations where club_id = v_club;
  if n <> 0 then e := e || format('le CM du club lit %s invitation(s)', n); end if;
  if peut_operer_club(v_club) then
    e := e || 'le CM du club a repris peut_operer_club : l argent et les gens rouvrent avec'::text;
  end if;
  if not peut_travailler_club(v_club) then
    e := e || 'le CM du club ne peut pas travailler son club'::text;
  end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le Community Manager du club construit le planning de SON club et travaille son calendrier, ses matchs et ses actualités ; il ne lit ni montants, ni sponsors, ni annuaire, ni invitations, ne touche pas au planning d''un autre club ni aux prix des galeries, et un coach du même club n''écrit rien.' as verdict;

rollback;
