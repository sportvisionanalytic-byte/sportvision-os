-- Dans Club+, le coach ne voit que les galeries de ses équipes (v155, 11/09/2026).
--
-- Demande de Fouka : « que les coachs voient bien leur truc de coach », sans mélange entre équipes.
-- media_club_galleries rendait à TOUT membre du club l'intégralité des galeries publiées.
-- Ce test tient pour vrai : le coach voit la galerie de son équipe et les galeries du club sans
-- équipe, jamais celle d'une autre équipe ; le président, le CM et le secrétariat voient tout.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fafafafa-0000-0000-0000-000000000001','zz-gc-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('fafafafa-0000-0000-0000-000000000002','zz-gc-president@example.invalid','',now(),'authenticated','authenticated'),
  ('fafafafa-0000-0000-0000-000000000003','zz-gc-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('fafafafa-0000-0000-0000-000000000004','zz-gc-secretaire@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values ('fafafafa-0000-0000-0000-000000000003','QA','CM','cm',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Coach Galeries (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Coach Galeries (test)', id, 'performance' from cli returning id)
  select (select id from clu) club_id, (select id from cli) client_id;
grant select on ctx to authenticated;
insert into club_teams (club_id, name) select club_id, n from ctx, (values ('ZZ U13'), ('ZZ U15')) v(n);
insert into club_members (user_id, club_id, role, status, teams)
select 'fafafafa-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '["ZZ U13"]'::jsonb from ctx union all
select 'fafafafa-0000-0000-0000-000000000002'::uuid, club_id, 'president', 'actif', null::jsonb from ctx union all
select 'fafafafa-0000-0000-0000-000000000004'::uuid, club_id, 'secretaire', 'actif', null::jsonb from ctx;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'fafafafa-0000-0000-0000-000000000003'::uuid, 'principal', current_date - 1, true from ctx;
insert into media_albums (title, club_id, team_id, status, published_at, event_date)
select 'ZZ Galerie U13', ctx.club_id, t.id, 'published', now(), current_date from ctx join club_teams t on t.club_id = ctx.club_id and t.name = 'ZZ U13' union all
select 'ZZ Galerie U15', ctx.club_id, t.id, 'published', now(), current_date from ctx join club_teams t on t.club_id = ctx.club_id and t.name = 'ZZ U15' union all
select 'ZZ Galerie du club', ctx.club_id, null, 'published', now(), current_date from ctx union all
select 'ZZ Galerie brouillon U13', ctx.club_id, t.id, 'draft', null, current_date from ctx join club_teams t on t.club_id = ctx.club_id and t.name = 'ZZ U13';

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.voit(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select coalesce(string_agg(titre, ', ' order by titre), '∅') into v from media_club_galleries((select club_id from ctx));
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('le coach : sa seule équipe, plus les galeries du club', 'ZZ Galerie du club, ZZ Galerie U13', pg_temp.voit('fafafafa-0000-0000-0000-000000000001'));
select pg_temp.note('le président : tout le club', 'ZZ Galerie du club, ZZ Galerie U13, ZZ Galerie U15', pg_temp.voit('fafafafa-0000-0000-0000-000000000002'));
select pg_temp.note('le CM affecté : tout le club', 'ZZ Galerie du club, ZZ Galerie U13, ZZ Galerie U15', pg_temp.voit('fafafafa-0000-0000-0000-000000000003'));
select pg_temp.note('le secrétariat du club : tout le club', 'ZZ Galerie du club, ZZ Galerie U13, ZZ Galerie U15', pg_temp.voit('fafafafa-0000-0000-0000-000000000004'));
select pg_temp.note('les brouillons ne sortent pour personne', 'non',
  case when pg_temp.voit('fafafafa-0000-0000-0000-000000000002') like '%brouillon%' then 'oui' else 'non' end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
