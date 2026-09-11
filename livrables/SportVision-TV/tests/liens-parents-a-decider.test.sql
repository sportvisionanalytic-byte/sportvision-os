-- Les demandes de rattachement parent, vues par ceux qui décident (v172, 12/09/2026).
--
-- Ce que ce test tient pour vrai : le dirigeant du club et l'éducateur de l'équipe de l'enfant
-- voient la demande et peuvent la trancher ; un coach d'une autre équipe ne la voit pas ; une fois
-- décidée, elle quitte la liste.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('c5c5c5c5-0000-0000-0000-000000000001','zz-lp-president@example.invalid','',now(),'authenticated','authenticated'),
  ('c5c5c5c5-0000-0000-0000-000000000002','zz-lp-coach-u11@example.invalid','',now(),'authenticated','authenticated'),
  ('c5c5c5c5-0000-0000-0000-000000000003','zz-lp-coach-u15@example.invalid','',now(),'authenticated','authenticated'),
  ('c5c5c5c5-0000-0000-0000-000000000004','zz-lp-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom)
values ('c5c5c5c5-0000-0000-0000-000000000004','c5c5c5c5-0000-0000-0000-000000000004','QA','Parent demandeur') on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Liens (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Liens (test)', id, 'performance' from cli returning id),
       e1 as (insert into club_teams (club_id, name) select id, 'ZZ U11 liens' from clu returning id, club_id),
       e2 as (insert into club_teams (club_id, name) select club_id, 'ZZ U15 liens' from e1 returning id),
       sa as (select id from saisons order by date_debut desc limit 1),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select club_id, 'QA', 'Enfant liens', date '2015-06-06', 'actif' from e1 returning id, club_id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select e1.id, j.id, e1.club_id, (select id from sa), '2026-2027', 'active' from e1, j returning player_id),
       r as (insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
             select 'c5c5c5c5-0000-0000-0000-000000000004', j.id, 'parent', 'en_attente_confirmation' from j returning id)
  select (select club_id from e1) club_id, (select id from j) player_id, (select id from r) relation;
grant select on ctx to authenticated;
insert into club_members (user_id, club_id, role, status, teams)
select 'c5c5c5c5-0000-0000-0000-000000000001'::uuid, club_id, 'president', 'actif', '[]'::jsonb from ctx union all
select 'c5c5c5c5-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', '["ZZ U11 liens"]'::jsonb from ctx union all
select 'c5c5c5c5-0000-0000-0000-000000000003'::uuid, club_id, 'coach', 'actif', '["ZZ U15 liens"]'::jsonb from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vu(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select coalesce(string_agg(parent || ' → ' || enfant, ', '), '∅') into v
      from liens_parents_a_decider((select club_id from ctx));
  exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.decide(p_uid uuid, p_decision text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select (decider_lien_parent((select relation from ctx), p_decision)).statut into v;
  exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;

select pg_temp.note('le président voit la demande', 'QA Parent demandeur → QA Enfant liens',
  pg_temp.vu('c5c5c5c5-0000-0000-0000-000000000001'));
select pg_temp.note('le coach de l''équipe de l''enfant aussi', 'QA Parent demandeur → QA Enfant liens',
  pg_temp.vu('c5c5c5c5-0000-0000-0000-000000000002'));
select pg_temp.note('le coach d''une autre équipe ne la voit pas', '∅',
  pg_temp.vu('c5c5c5c5-0000-0000-0000-000000000003'));
select pg_temp.note('le parent lui-même ne décide pas', 'refusé',
  pg_temp.decide('c5c5c5c5-0000-0000-0000-000000000004', 'confirme'));
select pg_temp.note('le coach de l''équipe confirme', 'confirme',
  pg_temp.decide('c5c5c5c5-0000-0000-0000-000000000002', 'confirme'));
select pg_temp.note('la demande quitte la liste', '∅',
  pg_temp.vu('c5c5c5c5-0000-0000-0000-000000000001'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
