-- Retirer un joueur coupe vraiment son accès (v179, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • une fiche joueur « retirée » n'ouvre plus rien : ni pour le joueur, ni pour son parent ;
--   • son affiliation à l'équipe est désactivée en même temps, et non laissée « active » ;
--   • le joueur ne se réactive pas lui-même quand c'est le club qui l'a retiré ;
--   • il ne change pas non plus son club tout seul.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('aa11aa11-0000-0000-0000-000000000001','zz-ret-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('aa11aa11-0000-0000-0000-000000000002','zz-ret-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom)
values ('aa11aa11-0000-0000-0000-000000000002','aa11aa11-0000-0000-0000-000000000002','QA','Parent retrait') on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Retrait (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Retrait (test)', id, 'performance' from cli returning id),
       cli2 as (insert into clients (nom, statut_relation) values ('ZZ Club Voisin Retrait (test)','partenaire') returning id),
       clu2 as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Voisin Retrait (test)', id, 'performance' from cli2 returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 retrait' from clu returning id, club_id),
       sa as (select id from saisons order by date_debut desc limit 1),
       j as (insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
             select club_id, 'aa11aa11-0000-0000-0000-000000000001', 'QA', 'Joueur retrait', date '2013-07-07', 'actif' from eq returning id, club_id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select eq.id, j.id, eq.club_id, (select id from sa), '2026-2027', 'active' from eq, j returning player_id)
  select (select id from j) player_id, (select id from eq) team_id, (select club_id from eq) club_id, (select id from clu2) autre_club;
grant select on ctx to authenticated;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'aa11aa11-0000-0000-0000-000000000002'::uuid, player_id, 'parent', 'confirme', now() from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.essai(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v; exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;

select pg_temp.note('avant retrait, le joueur est reconnu', 'true',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000001', 'select is_own_player((select player_id from ctx))::text'));
select pg_temp.note('avant retrait, la famille est reconnue sur l''équipe', 'true',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000002', 'select is_family_of_team((select team_id from ctx))::text'));

-- Le club retire le joueur.
update player_profiles set account_status = 'retire' where id = (select player_id from ctx);

select pg_temp.note('après retrait, le joueur n''est plus reconnu', 'false',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000001', 'select is_own_player((select player_id from ctx))::text'));
select pg_temp.note('après retrait, le parent non plus', 'false',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000002', 'select is_confirmed_parent_of((select player_id from ctx))::text'));
select pg_temp.note('après retrait, la famille ne voit plus l''équipe', 'false',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000002', 'select is_family_of_team((select team_id from ctx))::text'));
select pg_temp.note('l''affiliation à l''équipe est désactivée', 'quittee_club',
  (select statut from team_memberships tm, ctx where tm.player_id = ctx.player_id));

select pg_temp.note('le joueur ne se réactive pas lui-même', 'refusé',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000001',
    'update player_profiles set account_status = ''actif'' where id = (select player_id from ctx) returning account_status'));
select pg_temp.note('il est toujours retiré', 'retire',
  (select account_status from player_profiles p, ctx where p.id = ctx.player_id));
select pg_temp.note('et il ne change pas de club tout seul', 'refusé',
  pg_temp.essai('aa11aa11-0000-0000-0000-000000000001',
    'update player_profiles set club_id = (select autre_club from ctx) where id = (select player_id from ctx) returning club_id::text'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
