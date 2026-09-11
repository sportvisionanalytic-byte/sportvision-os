-- Le calendrier de l'enfant affilié à un club, vu par son parent (v166, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • le parent confirmé voit les matchs de l'équipe de son enfant et les rendez-vous du club ;
--   • un match reporté ou annulé le dit, au lieu de rester « à venir » ;
--   • un rendez-vous visant une AUTRE équipe ne lui parvient pas ;
--   • un parent non confirmé ne voit rien.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f3f3f3f3-3333-0000-0000-000000000001','zz-cal-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('f3f3f3f3-3333-0000-0000-000000000002','zz-cal-attente@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('f3f3f3f3-3333-0000-0000-000000000001','f3f3f3f3-3333-0000-0000-000000000001','QA','Parent confirmé'),
  ('f3f3f3f3-3333-0000-0000-000000000002','f3f3f3f3-3333-0000-0000-000000000002','QA','Parent en attente') on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Calendrier (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Calendrier (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U11 calendrier' from clu returning id, club_id),
       autre as (insert into club_teams (club_id, name) select club_id, 'ZZ U17 calendrier' from eq returning id),
       sa as (select id from saisons order by date_debut desc limit 1),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select club_id, 'QA', 'Enfant calendrier', date '2015-01-01', 'actif' from eq returning id, club_id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select eq.id, j.id, eq.club_id, (select id from sa), '2026-2027', 'active' from eq, j returning player_id)
  select (select id from eq) team_id, (select id from autre) autre_team, (select id from j) player_id, (select club_id from eq) club_id;

insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'f3f3f3f3-3333-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
select 'f3f3f3f3-3333-0000-0000-000000000002'::uuid, player_id, 'parent', 'en_attente_confirmation' from ctx;

insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, status)
select club_id, 'ZZ U11 calendrier', team_id, 'ZZ Adversaire A', current_date + 3, '10:00', 'a_venir' from ctx;
insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, status)
select club_id, 'ZZ U11 calendrier', team_id, 'ZZ Adversaire B', current_date + 10, '11:00', 'a_venir' from ctx;
update club_matches set status = 'annulee' where opponent = 'ZZ Adversaire B';
insert into club_calendar_events (club_id, event_date, type, title, team, team_id)
select club_id, current_date + 5, 'tournoi', 'ZZ Tournoi de l''équipe', 'ZZ U11 calendrier', team_id from ctx;
insert into club_calendar_events (club_id, event_date, type, title, team, team_id)
select club_id, current_date + 6, 'tournoi', 'ZZ Tournoi des grands', 'ZZ U17 calendrier', autre_team from ctx;
insert into club_calendar_events (club_id, event_date, type, title)
select club_id, current_date + 7, 'contenu', 'ZZ Photo de club' from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vu(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select coalesce(string_agg(title, ' | ' order by event_date), '∅')
      into v from connect_list_calendar_for_athletes() where athlete_kind = 'club';
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('le parent confirmé voit le match, le tournoi de l''équipe et la photo de club',
  'Match contre ZZ Adversaire A | ZZ Tournoi de l''équipe | ZZ Photo de club | Match contre ZZ Adversaire B (annulé)',
  pg_temp.vu('f3f3f3f3-3333-0000-0000-000000000001'));
select pg_temp.note('le tournoi de l''autre équipe ne lui parvient pas', 'non',
  case when pg_temp.vu('f3f3f3f3-3333-0000-0000-000000000001') like '%des grands%' then 'OUI' else 'non' end);
select pg_temp.note('un parent non confirmé ne voit rien', '∅',
  pg_temp.vu('f3f3f3f3-3333-0000-0000-000000000002'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
