-- Qui lit les matchs du club (v170, 12/09/2026).
--
-- Ce que ce test tient pour vrai : les rôles administratifs du club voient les matchs de toutes
-- les équipes, le coach ne voit que les siennes, et un membre d'un autre club ne voit rien.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b7b7b7b7-0000-0000-0000-000000000001','zz-mc-secretaire@example.invalid','',now(),'authenticated','authenticated'),
  ('b7b7b7b7-0000-0000-0000-000000000002','zz-mc-tresorier@example.invalid','',now(),'authenticated','authenticated'),
  ('b7b7b7b7-0000-0000-0000-000000000003','zz-mc-coach-u11@example.invalid','',now(),'authenticated','authenticated'),
  ('b7b7b7b7-0000-0000-0000-000000000004','zz-mc-autre-club@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club MatchCenter (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club MatchCenter (test)', id, 'performance' from cli returning id),
       cli2 as (insert into clients (nom, statut_relation) values ('ZZ Club Voisin (test)','partenaire') returning id),
       clu2 as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Voisin (test)', id, 'performance' from cli2 returning id),
       e1 as (insert into club_teams (club_id, name) select id, 'ZZ U11 mc' from clu returning id, club_id),
       e2 as (insert into club_teams (club_id, name) select club_id, 'ZZ U15 mc' from e1 returning id),
       m1 as (insert into club_matches (club_id, team, team_id, opponent, match_date, status)
              select club_id, 'ZZ U11 mc', id, 'ZZ Adv U11', current_date + 2, 'a_venir' from e1 returning id),
       m2 as (insert into club_matches (club_id, team, team_id, opponent, match_date, status)
              select e1.club_id, 'ZZ U15 mc', e2.id, 'ZZ Adv U15', current_date + 3, 'a_venir' from e1, e2 returning id)
  select (select club_id from e1) club_id, (select id from clu2) autre_club;
grant select on ctx to authenticated;
insert into club_members (user_id, club_id, role, status, teams)
select 'b7b7b7b7-0000-0000-0000-000000000001'::uuid, club_id, 'secretaire', 'actif', '[]'::jsonb from ctx union all
select 'b7b7b7b7-0000-0000-0000-000000000002'::uuid, club_id, 'tresorier', 'actif', '[]'::jsonb from ctx union all
select 'b7b7b7b7-0000-0000-0000-000000000003'::uuid, club_id, 'coach', 'actif', '["ZZ U11 mc"]'::jsonb from ctx union all
select 'b7b7b7b7-0000-0000-0000-000000000004'::uuid, autre_club, 'admin', 'actif', '[]'::jsonb from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vu(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(string_agg(opponent, ', ' order by opponent), '∅') into v
    from club_matches where opponent like 'ZZ Adv%';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('la secrétaire voit les matchs des deux équipes', 'ZZ Adv U11, ZZ Adv U15',
  pg_temp.vu('b7b7b7b7-0000-0000-0000-000000000001'));
select pg_temp.note('le trésorier aussi', 'ZZ Adv U11, ZZ Adv U15',
  pg_temp.vu('b7b7b7b7-0000-0000-0000-000000000002'));
select pg_temp.note('le coach ne voit que son équipe', 'ZZ Adv U11',
  pg_temp.vu('b7b7b7b7-0000-0000-0000-000000000003'));
select pg_temp.note('un dirigeant d''un autre club ne voit rien', '∅',
  pg_temp.vu('b7b7b7b7-0000-0000-0000-000000000004'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
