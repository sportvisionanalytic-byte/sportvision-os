-- Rejoindre une équipe : qui valide, et quand (v186, 12/09/2026).
--
-- Règle posée par Fouka : le coach de l'équipe ou un dirigeant du club valide une demande
-- d'adhésion, SAUF si la personne est arrivée par un code généré par le coach — dans ce cas c'est
-- automatique, donner le code valant acceptation.
--
-- Ce que ce test tient pour vrai :
--   • une demande spontanée attend, et le coach de l'équipe peut la valider ;
--   • un coach d'une AUTRE équipe ne peut pas ;
--   • une demande née d'un code d'équipe valide est validée d'emblée, et l'affiliation existe ;
--   • un club en contrôle renforcé garde la main, même avec un code.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ff55ff55-0000-0000-0000-000000000001','zz-adh-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('ff55ff55-0000-0000-0000-000000000002','zz-adh-joueur2@example.invalid','',now(),'authenticated','authenticated'),
  ('ff55ff55-0000-0000-0000-000000000003','zz-adh-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('ff55ff55-0000-0000-0000-000000000004','zz-adh-coach-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Adhesion (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan, membership_validation_mode, saison)
               select 'ZZ Club Adhesion (test)', id, 'performance', 'standard', '2026-2027' from cli returning id),
       e1 as (insert into club_teams (club_id, name) select id, 'ZZ Seniors adhesion' from clu returning id, club_id),
       e2 as (insert into club_teams (club_id, name) select club_id, 'ZZ U15 adhesion' from e1 returning id),
       code as (insert into team_invite_codes (team_id, club_id, code, actif, created_by)
                select e1.id, e1.club_id, 'ZZ-ADH-1234', true, 'ff55ff55-0000-0000-0000-000000000003' from e1 returning id, code)
  select (select club_id from e1) club_id, (select id from e1) equipe, (select id from e2) autre_equipe,
         (select code from code) code;
grant select on ctx to authenticated;
insert into club_members (user_id, club_id, role, status, teams)
select 'ff55ff55-0000-0000-0000-000000000003'::uuid, club_id, 'coach', 'actif', '["ZZ Seniors adhesion"]'::jsonb from ctx union all
select 'ff55ff55-0000-0000-0000-000000000004'::uuid, club_id, 'coach', 'actif', '["ZZ U15 adhesion"]'::jsonb from ctx;

create temp table memo (k text primary key, v uuid) on commit drop;
grant select, insert on memo to authenticated;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.essai(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v; exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;

-- 1. Demande SPONTANÉE, par un joueur majeur.
select pg_temp.note('la demande spontanée attend une décision', 'a_verifier',
  pg_temp.essai('ff55ff55-0000-0000-0000-000000000001',
    'select (request_team_membership_as_player((select club_id from ctx), (select equipe from ctx), null, ''QA'', ''Majeur spontane'', date ''2000-01-01'')).statut'));
insert into memo select 'spontanee', id from membership_requests where requested_by_user_id = 'ff55ff55-0000-0000-0000-000000000001' limit 1;

select pg_temp.note('le coach d''une autre équipe ne valide pas', 'refusé',
  left(
  pg_temp.essai('ff55ff55-0000-0000-0000-000000000004',
    'select (validate_team_membership((select v from memo where k = ''spontanee''))).statut'), 6));
select pg_temp.note('le coach de l''équipe valide', 'validee',
  pg_temp.essai('ff55ff55-0000-0000-0000-000000000003',
    'select (validate_team_membership((select v from memo where k = ''spontanee''))).statut'));

-- 2. Demande AVEC LE CODE du coach.
select pg_temp.note('avec le code du coach, la demande est validée d''emblée', 'validee',
  pg_temp.essai('ff55ff55-0000-0000-0000-000000000002',
    'select (request_team_membership_as_player((select club_id from ctx), (select equipe from ctx), (select code from ctx), ''QA'', ''Majeur code'', date ''1999-02-02'')).statut'));
select pg_temp.note('et l''affiliation à l''équipe existe', 'active',
  (select tm.statut from team_memberships tm join player_profiles p on p.id = tm.player_id
    where p.nom = 'Majeur code' limit 1));

-- 3. Le même code, dans un club qui exige le contrôle de l'administration.
update clubs set membership_validation_mode = 'controle' where id = (select club_id from ctx);
select pg_temp.note('en contrôle renforcé, le code ne valide plus tout seul', 'a_verifier',
  pg_temp.essai('ff55ff55-0000-0000-0000-000000000001',
    'select (request_team_membership_as_player((select club_id from ctx), (select equipe from ctx), (select code from ctx), ''QA'', ''Majeur controle'', date ''1998-03-03'')).statut'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
