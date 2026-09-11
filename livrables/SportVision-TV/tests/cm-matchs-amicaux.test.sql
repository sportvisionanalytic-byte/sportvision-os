-- Ajouter et reprogrammer un match dans Club+ (12/09/2026).
--
-- Demande de Fouka : « permettre au CM de créer des matchs amicaux… qu'il puisse modifier ou
-- rajouter des matchs dans les calendriers des équipes ». Ce test mesure qui peut le faire, avec
-- l'identité de chacun et les mêmes écritures que l'écran (club_matches).
--
-- Ce qu'il tient pour vrai : le CM affecté ajoute un amical et le reprogramme ; le coach le fait
-- pour SON équipe, jamais pour une autre ; un membre en lecture seule ne peut rien ; un CM d'un
-- autre club non plus. Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fdfdfdfd-0000-0000-0000-000000000001','zz-ma-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('fdfdfdfd-0000-0000-0000-000000000002','zz-ma-coach13@example.invalid','',now(),'authenticated','authenticated'),
  ('fdfdfdfd-0000-0000-0000-000000000003','zz-ma-lecture@example.invalid','',now(),'authenticated','authenticated'),
  ('fdfdfdfd-0000-0000-0000-000000000004','zz-ma-cm-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('fdfdfdfd-0000-0000-0000-000000000001','QA','CM','cm',true),
  ('fdfdfdfd-0000-0000-0000-000000000004','QA','CM autre','cm',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Amical (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Amical (test)', id, 'performance' from cli returning id)
  select (select id from clu) club_id, current_date + 7 as j;
grant select on ctx to authenticated;
insert into club_teams (club_id, name) select club_id, n from ctx, (values ('ZZ U13'), ('ZZ U15')) v(n);
insert into club_members (user_id, club_id, role, status, teams)
select 'fdfdfdfd-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', '["ZZ U13"]'::jsonb from ctx union all
select 'fdfdfdfd-0000-0000-0000-000000000003'::uuid, club_id, 'lecture_seule', 'actif', null::jsonb from ctx;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'fdfdfdfd-0000-0000-0000-000000000001'::uuid, 'principal', current_date - 1, true from ctx;
insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, competition, is_home)
select ctx.club_id, t.name, t.id, 'ZZ Adversaire ' || t.name, ctx.j, '15:00', 'Championnat', true
  from ctx join club_teams t on t.club_id = ctx.club_id;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé'; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics n = row_count;
    if n = 0 then v := 'aucune ligne'; end if;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
-- Un adversaire et une heure propres à chaque appel : deux matchs identiques (même équipe, même
-- adversaire, même date, même heure) sont volontairement refusés par la base (anti-doublon).
create or replace function pg_temp.amical(p_uid uuid, p_equipe text, p_marque text default 'A') returns text language sql as $$
  select pg_temp.fait(p_uid, format(
    'insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, competition, is_home) '
    || 'select %L, t.name, t.id, ''ZZ Amical %s %s'', %L, %L, ''Amical'', false from club_teams t where t.club_id = %L and t.name = %L',
    (select club_id from ctx), p_equipe, p_marque, (select j from ctx), case p_marque when 'A' then '18:30' when 'B' then '19:30' else '20:30' end,
    (select club_id from ctx), p_equipe)); $$;
create or replace function pg_temp.reprogrammer(p_uid uuid, p_equipe text) returns text language sql as $$
  select pg_temp.fait(p_uid, format(
    'update club_matches set match_date = %L, kickoff_time = ''20:00'', lieu = ''Stade ZZ'' where club_id = %L and team = %L and competition = ''Championnat''',
    (select j from ctx) + 1, (select club_id from ctx), p_equipe)); $$;

select pg_temp.note('le CM affecté ajoute un amical', 'autorisé', pg_temp.amical('fdfdfdfd-0000-0000-0000-000000000001', 'ZZ U13'));
select pg_temp.note('le CM affecté reprogramme un match', 'autorisé', pg_temp.reprogrammer('fdfdfdfd-0000-0000-0000-000000000001', 'ZZ U15'));
select pg_temp.note('le coach ajoute un amical pour SON équipe', 'autorisé', pg_temp.amical('fdfdfdfd-0000-0000-0000-000000000002', 'ZZ U13', 'B'));
select pg_temp.note('le coach reprogramme le match de son équipe', 'autorisé', pg_temp.reprogrammer('fdfdfdfd-0000-0000-0000-000000000002', 'ZZ U13'));
select pg_temp.note('le coach ne touche pas à une autre équipe', 'refusé', left(pg_temp.amical('fdfdfdfd-0000-0000-0000-000000000002', 'ZZ U15'), 6));
select pg_temp.note('le coach ne reprogramme pas le match d''une autre équipe', 'aucune ligne', pg_temp.reprogrammer('fdfdfdfd-0000-0000-0000-000000000002', 'ZZ U15'));
select pg_temp.note('un membre en lecture seule ne peut rien ajouter', 'refusé', left(pg_temp.amical('fdfdfdfd-0000-0000-0000-000000000003', 'ZZ U13', 'C'), 6));
-- Un CM d'un autre club ne voit même pas les équipes : rien à insérer, donc rien d'inséré.
select pg_temp.note('un CM d''un autre club ne voit rien de ce club', 'aucune ligne', pg_temp.amical('fdfdfdfd-0000-0000-0000-000000000004', 'ZZ U13', 'C'));
select pg_temp.note('et il n''a créé aucun match', '0',
  (select count(*)::text from club_matches where club_id = (select club_id from ctx) and opponent like 'ZZ Amical ZZ U13 C%'));
select pg_temp.note('l''amical est bien enregistré comme tel', 'Amical/false/18:30:00',
  (select competition || '/' || is_home || '/' || kickoff_time from club_matches
    where club_id = (select club_id from ctx) and opponent = 'ZZ Amical ZZ U13 A' limit 1));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
