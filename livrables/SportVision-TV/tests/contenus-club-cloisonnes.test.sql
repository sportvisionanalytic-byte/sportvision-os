-- Les contenus du club, vus par un coach borné à ses équipes (v171, 12/09/2026).
--
-- Ce que ce test tient pour vrai : un coach voit les contenus de SES équipes et ceux qui ne visent
-- aucune équipe ; il ne voit pas ceux d'une autre équipe. La secrétaire, elle, voit tout.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b8b8b8b8-0000-0000-0000-000000000001','zz-cc-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('b8b8b8b8-0000-0000-0000-000000000002','zz-cc-secretaire@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Contenus (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Contenus (test)', id, 'performance' from cli returning id),
       e1 as (insert into club_teams (club_id, name) select id, 'ZZ U11 cc' from clu returning id, club_id),
       e2 as (insert into club_teams (club_id, name) select club_id, 'ZZ U15 cc' from e1 returning id)
  select (select club_id from e1) club_id;
grant select on ctx to authenticated;
insert into club_members (user_id, club_id, role, status, teams)
select 'b8b8b8b8-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '["ZZ U11 cc"]'::jsonb from ctx union all
select 'b8b8b8b8-0000-0000-0000-000000000002'::uuid, club_id, 'secretaire', 'actif', '[]'::jsonb from ctx;
insert into club_media (club_id, title, type, team)
select club_id, 'ZZ Contenu U11', 'photo', 'ZZ U11 cc' from ctx union all
select club_id, 'ZZ Contenu U15', 'photo', 'ZZ U15 cc' from ctx union all
select club_id, 'ZZ Contenu du club', 'photo', null from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vu(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(string_agg(title, ', ' order by title), '∅') into v from club_media where title like 'ZZ Contenu%';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('le coach voit son équipe et le contenu du club, pas l''autre équipe',
  'ZZ Contenu du club, ZZ Contenu U11', pg_temp.vu('b8b8b8b8-0000-0000-0000-000000000001'));
select pg_temp.note('la secrétaire voit tout',
  'ZZ Contenu du club, ZZ Contenu U11, ZZ Contenu U15', pg_temp.vu('b8b8b8b8-0000-0000-0000-000000000002'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
