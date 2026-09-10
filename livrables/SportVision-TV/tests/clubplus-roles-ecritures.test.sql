-- Ce que les rôles de second rang d'un club ÉCRIVENT réellement (décisions Club+ du 10/09/2026, n° 1).
--
-- Mesure la migration-decisions-clubplus-01-ecritures-par-role.sql. Chaque essai est joué sous
-- l'identité de la personne (rôle `authenticated` + son `sub`, exactement ce que fait PostgREST
-- avec son jeton) : la RLS s'applique. Le décor est posé en service, les verdicts relus en service.
--
--   Sans la migration (base actuelle) : rouge sur les écritures qu'elle ferme.
--   Avec la migration : node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs
--   (AVEC_MIGRATION=1 injecte la migration dans la même transaction).
--
-- Contrôles positifs inclus : l'Owner Club+ écrit toujours, le responsable d'équipe tient les
-- créneaux de SON équipe, le responsable sponsors gère les sponsors, la lecture seule ouvre un
-- ticket d'aide et modifie sa propre fiche. Sans eux, un refus général passerait pour un succès.
--
-- Tout est annulé, rien ne subsiste. Club de test « Villeneuve 340 SC » uniquement.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select c.id as club_id,
         (select id from club_teams where club_id = c.id and not archivee order by name desc limit 1) as equipe_a,
         (select id from club_teams where club_id = c.id and not archivee order by name asc limit 1) as equipe_b
    from clubs c where c.nom = 'Villeneuve 340 SC';
grant select on ctx to authenticated;

do $$ begin
  if (select count(*) from ctx) <> 1 or (select equipe_a from ctx) is null or (select equipe_b from ctx) is null
     or (select equipe_a from ctx) = (select equipe_b from ctx) then
    raise exception 'DÉCOR INVALIDE : il faut le club de test et deux équipes distinctes.';
  end if;
end $$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('dddddddd-0000-0000-0000-000000000001','zz-cp-dec-sql-owner@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000002','zz-cp-dec-sql-respequipe@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000003','zz-cp-dec-sql-lecture@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000004','zz-cp-dec-sql-bureau@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000005','zz-cp-dec-sql-sponsors@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000006','zz-cp-dec-sql-cm@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

-- Le CM SportVision affecté au club : il opère le club sans en être membre (peut_operer_club).
insert into profiles (id, prenom, nom, role) values ('dddddddd-0000-0000-0000-000000000006','ZZ','CM','cm')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'dddddddd-0000-0000-0000-000000000006', 'secondaire', current_date, true from ctx;

-- Le responsable d'équipe encadre l'équipe A, jamais la B (club_members.teams, par nom).
insert into club_members (user_id, club_id, role, status, prenom, nom, teams)
select v.uid, ctx.club_id, v.role, 'actif', 'ZZ', v.role,
       case when v.role = 'resp_equipe' then jsonb_build_array((select name from club_teams where id = ctx.equipe_a)) else '[]'::jsonb end
  from ctx, (values
    ('dddddddd-0000-0000-0000-000000000001'::uuid, 'admin'),
    ('dddddddd-0000-0000-0000-000000000002'::uuid, 'resp_equipe'),
    ('dddddddd-0000-0000-0000-000000000003'::uuid, 'lecture_seule'),
    ('dddddddd-0000-0000-0000-000000000004'::uuid, 'membre_bureau'),
    ('dddddddd-0000-0000-0000-000000000005'::uuid, 'sponsor_mgr')) as v(uid, role);

-- Objets que chacun va tenter de modifier ou supprimer.
create temp table cibles (creneau_b uuid, lieu uuid, match_club uuid, sponsor uuid) on commit drop;
grant select on cibles to authenticated;
do $$
declare v_creneau uuid; v_lieu uuid; v_match uuid; v_sponsor uuid;
begin
  insert into club_team_training_slots (team_id, jour, heure_debut) select equipe_b, 'lundi', '18:00' from ctx returning id into v_creneau;
  insert into club_venues (club_id, nom) select club_id, 'ZZ Stade décor' from ctx returning id into v_lieu;
  -- Un match SANS équipe : c'est le cas que les policies « tout membre » ouvraient à chacun.
  insert into club_matches (club_id, team, opponent, match_date, status)
    select club_id, 'ZZ', 'ZZ Adversaire', current_date + 30, 'a_venir' from ctx returning id into v_match;
  insert into club_sponsors (club_id, name) select club_id, 'ZZ Sponsor décor sql' from ctx returning id into v_sponsor;
  insert into cibles values (v_creneau, v_lieu, v_match, v_sponsor);
end $$;
insert into club_onboarding_progress (club_id, statut) select club_id, 'in_progress' from ctx
  on conflict (club_id) do nothing;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

-- Joue `p_sql` sous l'identité `p_uid`. « autorisé » si au moins une ligne est touchée : un
-- UPDATE ou un DELETE filtré par la RLS ne lève aucune erreur, il ne touche simplement rien.
--
-- Chaque essai est ANNULÉ aussitôt mesuré (exception volontaire, rattrapée) : sinon le premier
-- rôle qui supprime le créneau cible laisse les suivants mesurer une table vide, et un doublon
-- d'insertion se lit comme un refus. Premier passage de ce test : faux verts sur trois rôles,
-- pour exactement ces deux raisons.
create or replace function pg_temp.essai(p_controle text, p_uid uuid, p_sql text, p_attendu text) returns void language plpgsql as $$
declare
  v_n int := 0;
  v_obtenu text;
begin
  perform pg_temp.en(p_uid);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception 'zz-essai-annule';
  exception when others then
    v_obtenu := case when sqlerrm = 'zz-essai-annule' and v_n > 0 then 'autorisé' else 'refusé' end;
  end;
  perform pg_temp.hors();
  insert into verdicts (controle, attendu, obtenu) values (p_controle, p_attendu, v_obtenu);
end $$;

do $$
declare
  owner    uuid := 'dddddddd-0000-0000-0000-000000000001';
  resp     uuid := 'dddddddd-0000-0000-0000-000000000002';
  lecture  uuid := 'dddddddd-0000-0000-0000-000000000003';
  bureau   uuid := 'dddddddd-0000-0000-0000-000000000004';
  sponsors uuid := 'dddddddd-0000-0000-0000-000000000005';
  cm       uuid := 'dddddddd-0000-0000-0000-000000000006';
  c uuid := (select club_id from ctx);
  ea uuid := (select equipe_a from ctx);
  eb uuid := (select equipe_b from ctx);
  qui record;
begin
  -- ── B. Paramètres du club ──
  for qui in select * from (values ('lecture seule', lecture), ('membre du bureau', bureau),
                                   ('responsable sponsors', sponsors), ('responsable d''équipe', resp)) v(nom, uid) loop
    perform pg_temp.essai('créneau d''une équipe qu''il n''encadre pas, ajout — ' || qui.nom, qui.uid,
      format('insert into club_team_training_slots (team_id, jour, heure_debut) values (%L, ''mardi'', ''19:00'')', eb), 'refusé');
    perform pg_temp.essai('créneau d''une équipe qu''il n''encadre pas, suppression — ' || qui.nom, qui.uid,
      format('delete from club_team_training_slots where id = %L', (select creneau_b from cibles)), 'refusé');
    perform pg_temp.essai('lieu du club, ajout — ' || qui.nom, qui.uid,
      format('insert into club_venues (club_id, nom) values (%L, ''ZZ Stade essai'')', c), 'refusé');
    perform pg_temp.essai('lieu du club, modification — ' || qui.nom, qui.uid,
      format('update club_venues set notes = ''zz'' where id = %L', (select lieu from cibles)), 'refusé');
    perform pg_temp.essai('onboarding marqué « soumis » — ' || qui.nom, qui.uid,
      format('update club_onboarding_progress set statut = ''submitted'' where club_id = %L', c), 'refusé');
  end loop;
  perform pg_temp.essai('créneau de SON équipe, ajout — responsable d''équipe', resp,
    format('insert into club_team_training_slots (team_id, jour, heure_debut) values (%L, ''mercredi'', ''18:30'')', ea), 'autorisé');

  -- ── A. Données d'exploitation : lecture seule, membre du bureau, responsable sponsors ──
  for qui in select * from (values ('lecture seule', lecture), ('membre du bureau', bureau), ('responsable sponsors', sponsors)) v(nom, uid) loop
    perform pg_temp.essai('demande de visuel — ' || qui.nom, qui.uid,
      format('insert into club_creations (club_id, title, type, status) values (%L, ''ZZ essai'', ''visuel'', ''brouillon'')', c), 'refusé');
    perform pg_temp.essai('réservation d''une prestation au nom du club — ' || qui.nom, qui.uid,
      format('insert into club_bookings (club_id, service_label, status) values (%L, ''ZZ essai'', ''recue'')', c), 'refusé');
    perform pg_temp.essai('match du club, modification — ' || qui.nom, qui.uid,
      format('update club_matches set score = ''9-0'' where id = %L', (select match_club from cibles)), 'refusé');
    perform pg_temp.essai('événement au calendrier — ' || qui.nom, qui.uid,
      format('insert into club_calendar_events (club_id, event_date, type, title) values (%L, current_date + 3, ''tournoi'', ''ZZ essai'')', c), 'refusé');
    perform pg_temp.essai('actualité proposée — ' || qui.nom, qui.uid,
      format('insert into club_newsroom_items (club_id, title, status) values (%L, ''ZZ essai'', ''recu'')', c), 'refusé');
    perform pg_temp.essai('média déposé — ' || qui.nom, qui.uid,
      format('insert into club_media (club_id, title, type, source) values (%L, ''ZZ essai'', ''photo'', ''interne'')', c), 'refusé');
  end loop;

  -- ── Ce qui doit continuer de marcher ──
  perform pg_temp.essai('demande de visuel — responsable d''équipe (comme un coach)', resp,
    format('insert into club_creations (club_id, title, type, status) values (%L, ''ZZ essai'', ''visuel'', ''brouillon'')', c), 'autorisé');
  perform pg_temp.essai('sponsor, ajout — responsable sponsors', sponsors,
    format('insert into club_sponsors (club_id, name) values (%L, ''ZZ Sponsor essai'')', c), 'autorisé');
  perform pg_temp.essai('sponsor, modification — responsable sponsors', sponsors,
    format('update club_sponsors set secteur = ''zz'' where id = %L', (select sponsor from cibles)), 'autorisé');
  perform pg_temp.essai('ticket d''aide — lecture seule', lecture,
    format('insert into club_support_tickets (club_id, subject, message) values (%L, ''ZZ essai'', ''zz'')', c), 'autorisé');
  perform pg_temp.essai('sa propre fiche — lecture seule', lecture,
    format('update club_members set telephone = ''0600000000'' where user_id = %L and club_id = %L', lecture, c), 'autorisé');
  perform pg_temp.essai('lieu du club, ajout — Owner Club+', owner,
    format('insert into club_venues (club_id, nom) values (%L, ''ZZ Stade owner'')', c), 'autorisé');
  perform pg_temp.essai('onboarding marqué « soumis » — Owner Club+', owner,
    format('update club_onboarding_progress set statut = ''submitted'' where club_id = %L', c), 'autorisé');
  perform pg_temp.essai('événement au calendrier — Owner Club+', owner,
    format('insert into club_calendar_events (club_id, event_date, type, title) values (%L, current_date + 3, ''tournoi'', ''ZZ essai'')', c), 'autorisé');
  perform pg_temp.essai('créneau d''une autre équipe, suppression — Owner Club+', owner,
    format('delete from club_team_training_slots where id = %L', (select creneau_b from cibles)), 'autorisé');
  perform pg_temp.essai('lieu du club, ajout — CM SportVision affecté', cm,
    format('insert into club_venues (club_id, nom) values (%L, ''ZZ Stade cm'')', c), 'autorisé');
  perform pg_temp.essai('onboarding marqué « soumis » — CM SportVision affecté', cm,
    format('update club_onboarding_progress set statut = ''submitted'' where club_id = %L', c), 'autorisé');
  perform pg_temp.essai('créneau d''une équipe, ajout — CM SportVision affecté', cm,
    format('insert into club_team_training_slots (team_id, jour, heure_debut) values (%L, ''jeudi'', ''20:00'')', eb), 'autorisé');
  perform pg_temp.essai('demande de visuel — CM SportVision affecté', cm,
    format('insert into club_creations (club_id, title, type, status) values (%L, ''ZZ essai'', ''visuel'', ''brouillon'')', c), 'autorisé');
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
