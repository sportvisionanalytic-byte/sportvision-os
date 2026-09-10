-- La fiche d'une équipe : encadrement et statut réel des invitations, droit à l'image joueur par
-- joueur, alertes — et qui peut la lire.
--
-- Ce que ce test tient pour vrai (migration v121, 10/09/2026) :
--   • une invitation d'encadrant passe de « préparée » à « envoyée » puis « ouverte » quand la
--     personne ouvre le lien — et l'ouverture se marque sans compte, par le seul jeton ;
--   • le droit à l'image se compte joueur par joueur : validé, en attente, refusé, aucune ;
--   • une équipe sans encadrant et sans créneau le dit dans ses alertes ;
--   • le CM du club et le coach de l'équipe lisent la fiche ; le coach d'une autre équipe, un CM
--     d'un autre club et un visiteur, non.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select id from clubs where nom = 'Villeneuve 340 SC') as autre_club,
         (select saison from clubs where id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54') as saison;
grant select on ctx to authenticated, anon;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('cdcdcdcd-0000-0000-0000-000000000001','zz-apercu-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('cdcdcdcd-0000-0000-0000-000000000002','zz-apercu-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('cdcdcdcd-0000-0000-0000-000000000003','zz-apercu-coach-autre@example.invalid','',now(),'authenticated','authenticated'),
  ('cdcdcdcd-0000-0000-0000-000000000004','zz-apercu-cm-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, role) values
  ('cdcdcdcd-0000-0000-0000-000000000001','QA','CM','cm'),
  ('cdcdcdcd-0000-0000-0000-000000000004','QA','CM autre','cm')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'cdcdcdcd-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx
union all
select autre_club, 'cdcdcdcd-0000-0000-0000-000000000004'::uuid, 'secondaire', current_date, true from ctx;

-- Deux équipes de test : A (celle qu'on examine), B (celle de l'autre coach).
insert into club_teams (club_id, name, categorie, section)
select club_id, 'ZZ Aperçu A', 'U12', 'Féminin' from ctx
union all
select club_id, 'ZZ Aperçu B', 'U12', 'Masculin' from ctx;
create temp table eq on commit drop as
  select (select id from club_teams where name = 'ZZ Aperçu A') as a, (select id from club_teams where name = 'ZZ Aperçu B') as b;
grant select on eq to authenticated, anon;

insert into club_members (user_id, club_id, role, status, teams)
select 'cdcdcdcd-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', '["ZZ Aperçu A"]'::jsonb from ctx
union all
select 'cdcdcdcd-0000-0000-0000-000000000003'::uuid, club_id, 'coach', 'actif', '["ZZ Aperçu B"]'::jsonb from ctx;

-- Trois joueurs dans A : un autorisé, un refusé, un sans autorisation.
do $$
declare v_p uuid; v_type uuid; v_version uuid; i int;
begin
  select id into v_type from authorization_types where code = 'droit_image';
  select id into v_version from authorization_versions where authorization_type_id = v_type and actif order by created_at desc limit 1;
  for i in 1..3 loop
    insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
    values ((select club_id from ctx), 'Joueuse' || i, 'Zzapercu', date '2014-01-01', 'sans_compte') returning id into v_p;
    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_p, (select a from eq), (select club_id from ctx), (select saison from ctx), 'active');
    if i = 1 and v_version is not null then
      insert into parental_authorizations (player_id, authorization_type_id, version_id, statut) values (v_p, v_type, v_version, 'valide');
    elsif i = 2 and v_version is not null then
      insert into parental_authorizations (player_id, authorization_type_id, version_id, statut) values (v_p, v_type, v_version, 'refusee');
    end if;
  end loop;
end $$;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated, anon;
create temp table memo (cle text primary key, v jsonb) on commit drop;
grant select, insert, update on memo to authenticated, anon;

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
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts values (p_c, p_a, p_o); $$;

-- ── L'invitation du coach principal, préparée par le CM ───────────────────────
do $$
declare v jsonb; v_statut text;
begin
  perform pg_temp.en('cdcdcdcd-0000-0000-0000-000000000001');
  perform preparer_invitation_club((select club_id from ctx), 'zz-apercu-invite@example.invalid', 'resp_equipe', 'Nils', 'Dirigeant', null, '["ZZ Aperçu A"]'::jsonb);
  v := equipe_apercu((select a from eq));
  perform pg_temp.hors();
  insert into memo values ('apercu', v);
  select x->>'statut' into v_statut from jsonb_array_elements(v->'encadrement') x where x->>'email' = 'zz-apercu-invite@example.invalid';
  perform pg_temp.note('encadrement : l''invitation préparée apparaît « preparee »', 'preparee', coalesce(v_statut, 'absente'));
end $$;

-- Envoyée, puis ouverte par la personne, sans compte, avec le seul jeton.
update club_invitations set statut = 'envoyee', sent_at = now() where email = 'zz-apercu-invite@example.invalid';
create temp table lien on commit drop as select token from club_invitations where email = 'zz-apercu-invite@example.invalid';
grant select on lien to anon;
do $$
declare v jsonb; v_statut text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  perform marquer_invitation_ouverte((select token from lien));
  execute 'reset role';
  perform pg_temp.en('cdcdcdcd-0000-0000-0000-000000000001');
  v := equipe_apercu((select a from eq));
  perform pg_temp.hors();
  select x->>'statut' into v_statut from jsonb_array_elements(v->'encadrement') x where x->>'email' = 'zz-apercu-invite@example.invalid';
  perform pg_temp.note('encadrement : ouverte par le lien, sans compte', 'ouverte', coalesce(v_statut, 'absente'));
end $$;

-- ── Droit à l'image, effectif, alertes ────────────────────────────────────────
do $$
declare v jsonb := (select v from memo where cle = 'apercu');
begin
  perform pg_temp.note('droit à l''image : 3 joueuses, 1 validée, 1 refus, 1 en attente', '3/1/1/1',
    concat_ws('/', v->'droit_image'->>'total', v->'droit_image'->>'valides', v->'droit_image'->>'refus', v->'droit_image'->>'en_attente'));
  perform pg_temp.note('droit à l''image : chaque joueuse porte son statut', 'aucune,refus,valide',
    (select string_agg(j->>'image', ',' order by j->>'image') from jsonb_array_elements(v->'droit_image'->'joueurs') j));
  perform pg_temp.note('alerte : aucun créneau d''entraînement', 'oui',
    case when v->'alertes' @> '[{"code":"creneau"}]' then 'oui' else 'non' end);
  perform pg_temp.note('alerte : droit à l''image incomplet', 'oui',
    case when v->'alertes' @> '[{"code":"droit_image"}]' then 'oui' else 'non' end);
  perform pg_temp.note('alerte : pas « sans coach », un coach est rattaché', 'non',
    case when v->'alertes' @> '[{"code":"sans_coach"}]' then 'oui' else 'non' end);
  perform pg_temp.note('équipe : 3 joueuses, 1 encadrant actif', '3/1',
    concat_ws('/', v->'equipe'->>'joueurs', v->'equipe'->>'encadrants'));
end $$;

-- ── club_equipes_etat rend le sexe ─────────────────────────────────────────────
do $$
declare v_section text;
begin
  perform pg_temp.en('cdcdcdcd-0000-0000-0000-000000000001');
  select section into v_section from club_equipes_etat((select club_id from ctx)) where nom = 'ZZ Aperçu A';
  perform pg_temp.hors();
  perform pg_temp.note('état des équipes : le sexe de l''équipe', 'Féminin', coalesce(v_section, 'nul'));
end $$;

-- ── Qui lit la fiche ──────────────────────────────────────────────────────────
do $$
declare r record; v_ok text;
begin
  for r in select * from (values
      ('coach de l''équipe', 'cdcdcdcd-0000-0000-0000-000000000002'::uuid, 'lit'),
      ('coach d''une autre équipe', 'cdcdcdcd-0000-0000-0000-000000000003'::uuid, 'refusé'),
      ('CM d''un autre club', 'cdcdcdcd-0000-0000-0000-000000000004'::uuid, 'refusé')) t(qui, uid, attendu) loop
    perform pg_temp.en(r.uid);
    begin perform equipe_apercu((select a from eq)); v_ok := 'lit';
    exception when others then v_ok := 'refusé'; end;
    perform pg_temp.hors();
    perform pg_temp.note('fiche équipe — ' || r.qui, r.attendu, v_ok);
  end loop;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin perform equipe_apercu((select a from eq)); v_ok := 'lit';
  exception when others then v_ok := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.note('fiche équipe — visiteur sans compte', 'refusé', v_ok);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
