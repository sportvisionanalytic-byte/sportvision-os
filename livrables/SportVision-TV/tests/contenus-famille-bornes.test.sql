-- Les contenus du club rendus à une famille (v167, 12/09/2026).
--
-- Ce que ce test tient pour vrai : un média du club n'arrive chez le parent que si une règle de
-- visibilité le lui ouvre. Sans règle, réservé à une autre équipe, ou masqué après signalement :
-- il ne sort pas.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f4f4f4f4-4444-0000-0000-000000000001','zz-med-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom)
values ('f4f4f4f4-4444-0000-0000-000000000001','f4f4f4f4-4444-0000-0000-000000000001','QA','Parent média') on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Médias (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Médias (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 médias' from clu returning id, club_id),
       autre as (insert into club_teams (club_id, name) select club_id, 'ZZ U18 médias' from eq returning id),
       sa as (select id from saisons order by date_debut desc limit 1),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select club_id, 'QA', 'Enfant médias', date '2013-01-01', 'actif' from eq returning id, club_id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select eq.id, j.id, eq.club_id, (select id from sa), '2026-2027', 'active' from eq, j returning player_id),
       m1 as (insert into club_media (club_id, title, type, team) select club_id, 'ZZ Média ouvert à l''équipe', 'photo', 'ZZ U13 médias' from eq returning id),
       m2 as (insert into club_media (club_id, title, type, team) select club_id, 'ZZ Média de l''autre équipe', 'photo', 'ZZ U18 médias' from eq returning id),
       m3 as (insert into club_media (club_id, title, type, team) select club_id, 'ZZ Média sans regle', 'photo', 'ZZ U13 médias' from eq returning id)
  select (select id from eq) team_id, (select id from autre) autre_team, (select id from j) player_id,
         (select club_id from eq) club_id, (select id from m1) m1, (select id from m2) m2, (select id from m3) m3;

insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'f4f4f4f4-4444-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;
-- Une règle ouvre le premier média à l'équipe de l'enfant, une autre ouvre le second à l'autre équipe.
insert into media_access_rules (media_ref_type, media_ref_id, club_id, visibility_mode, team_id, visible_parent, visible_joueur)
select 'club_media', m1, club_id, 'team', team_id, true, true from ctx;
insert into media_access_rules (media_ref_type, media_ref_id, club_id, visibility_mode, team_id, visible_parent, visible_joueur)
select 'club_media', m2, club_id, 'team', autre_team, true, true from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vu() returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"f4f4f4f4-4444-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    select coalesce(string_agg(title, ' | ' order by title), '∅') into v
      from connect_list_contents_for_athletes() where title like 'ZZ Média%';
  exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('le parent ne voit que le média ouvert à l''équipe de son enfant',
  'ZZ Média ouvert à l''équipe', pg_temp.vu());

-- Le média est ensuite masqué après signalement : il disparaît.
insert into media_reports (media_ref_type, media_ref_id, club_id, motif, statut, reported_by)
select 'club_media', m1, club_id, 'droit_image', 'media_masque', 'f4f4f4f4-4444-0000-0000-000000000001' from ctx;
select pg_temp.note('un média masqué après signalement ne sort plus', '∅', pg_temp.vu());

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
