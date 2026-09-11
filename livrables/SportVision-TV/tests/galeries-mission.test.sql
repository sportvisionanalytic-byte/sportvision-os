-- Les galeries d'une mission, créées d'un clic (v154, 11/09/2026).
--
-- Décisions de Fouka : une galerie par équipe (jamais de mélange), rattachée au club, à l'équipe,
-- à la mission et à la date ; pour une prestation ponctuelle sans club, une galerie rattachée à la
-- prestation. Ce test tient pour vrai :
--   • mission de tournoi à deux équipes → deux galeries, chacune avec son équipe, son adversaire
--     dans le titre, la date, la saison de cette date, le pôle, en brouillon ;
--   • relancer ne crée rien de plus ;
--   • prestation ponctuelle sans club → une galerie de la prestation, au nom du client ;
--   • équipe connue seulement par le nom saisi sur la mission → retrouvée quand même ;
--   • un photographe ou la Production d'un autre pôle ne peuvent pas le faire.
-- Décor fictif (pôle Basket, sans Production réelle), tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f9f9f9f9-0000-0000-0000-000000000001','zz-gal-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('f9f9f9f9-0000-0000-0000-000000000002','zz-gal-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('f9f9f9f9-0000-0000-0000-000000000003','zz-gal-prod-foot@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('f9f9f9f9-0000-0000-0000-000000000001','QA','Prod','prod',true),
  ('f9f9f9f9-0000-0000-0000-000000000002','QA','Photo','photo',true),
  ('f9f9f9f9-0000-0000-0000-000000000003','QA','Prod Foot','prod',true)
on conflict (id) do update set role = excluded.role;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select (select id from poles where nom = 'Basket'), 'f9f9f9f9-0000-0000-0000-000000000001'::uuid, 'membre', true union all
select (select id from poles where nom = 'Football'), 'f9f9f9f9-0000-0000-0000-000000000003'::uuid, 'membre', true;

create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Club Galeries (test)', 'partenaire', id from pole returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Galeries (test)', id, 'performance' from cli returning id),
       solo as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Famille Martin (test)', 'client', id from pole returning id)
  select (select id from pole) pole_id, (select id from cli) client_id, (select id from clu) club_id, (select id from solo) solo_id,
         date '2026-10-17' as j;
grant select on ctx to authenticated;
insert into club_teams (club_id, name) select club_id, n from ctx, (values ('ZZ U10 A'), ('ZZ U10 B'), ('ZZ Séniors')) v(n);
insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, lieu)
select ctx.club_id, t.name, t.id, 'ZZ Adversaire ' || right(t.name, 1), ctx.j, '10:00', 'Stade ZZ'
  from ctx join club_teams t on t.club_id = ctx.club_id and t.name in ('ZZ U10 A', 'ZZ U10 B');
create temp table m (k text primary key, id uuid) on commit drop;
grant select on m to authenticated;
with p as (insert into prestations (client_id, pole_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, equipes)
           select client_id, pole_id, j, '10:00', 'Stade ZZ', 'match', 'livrée', 'interne', 'ZZ U10 A, ZZ U10 B' from ctx returning id)
insert into m select 'tournoi', id from p;
with plan as (insert into monthly_production_plans (client_id, cm_id, mois)
              select client_id, 'f9f9f9f9-0000-0000-0000-000000000001'::uuid, date_trunc('month', j)::date from ctx returning id)
insert into planned_presences (plan_id, match_id, date_presence, statut, created_prestation_id, type_couverture, source)
select (select id from plan), cm.id, ctx.j, 'mission_creee', (select id from m where k = 'tournoi'), 'photo_video', 'cm_initiated'
  from ctx join club_matches cm on cm.club_id = ctx.club_id;
with p as (insert into prestations (client_id, pole_id, date_prestation, heure_debut, lieu, type_prestation, statut, source)
           select solo_id, pole_id, j, '15:00', 'Parc ZZ', 'portrait', 'livrée', 'interne' from ctx returning id)
insert into m select 'ponctuelle', id from p;
with p as (insert into prestations (client_id, pole_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, equipes)
           select client_id, pole_id, j + 1, '15:00', 'Stade ZZ', 'match', 'livrée', 'interne', 'ZZ Séniors' from ctx returning id)
insert into m select 'par_nom', id from p;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.creer(p_uid uuid, p_cle text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select count(*) filter (where cree)::text || ' créée(s) / ' || count(*)::text into v
      from creer_galeries_mission((select id from m where k = p_cle));
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.albums(p_cle text) returns text language sql as $$
  select string_agg(coalesce((select name from club_teams where id = a.team_id), '∅') || ' | ' || a.title || ' | ' || a.status
                    || ' | ' || coalesce((select label from saisons where id = a.saison_id), '∅') || ' | '
                    || case when a.pole_id = (select pole_id from ctx) then 'pôle' else 'hors pôle' end, ' ; ' order by a.title)
    from media_albums a where a.mission_id = (select id from m where k = p_cle); $$;

select pg_temp.note('un photographe ne crée pas les galeries', 'refusé', left(pg_temp.creer('f9f9f9f9-0000-0000-0000-000000000002', 'tournoi'), 6));
select pg_temp.note('la Production d''un autre pôle non plus', 'refusé', left(pg_temp.creer('f9f9f9f9-0000-0000-0000-000000000003', 'tournoi'), 6));
select pg_temp.note('tournoi à deux équipes : deux galeries créées', '2 créée(s) / 2', pg_temp.creer('f9f9f9f9-0000-0000-0000-000000000001', 'tournoi'));
select pg_temp.note('une par équipe, titre avec l''adversaire et la date, brouillon, saison de la date, pôle',
  'ZZ U10 A | ZZ U10 A — vs ZZ Adversaire A — 17/10/2026 | draft | 2026-2027 | pôle ; ZZ U10 B | ZZ U10 B — vs ZZ Adversaire B — 17/10/2026 | draft | 2026-2027 | pôle',
  pg_temp.albums('tournoi'));
select pg_temp.note('toutes rattachées au club', '2', (select count(*)::text from media_albums where mission_id = (select id from m where k = 'tournoi') and club_id = (select club_id from ctx)));
select pg_temp.note('relancer ne crée rien de plus', '0 créée(s) / 2', pg_temp.creer('f9f9f9f9-0000-0000-0000-000000000001', 'tournoi'));
select pg_temp.note('prestation ponctuelle : une galerie de la prestation', '1 créée(s) / 1', pg_temp.creer('f9f9f9f9-0000-0000-0000-000000000001', 'ponctuelle'));
select pg_temp.note('au nom du client, sans club ni équipe', 'ZZ Famille Martin (test)|∅|∅',
  (select coalesce(structure_externe, '∅') || '|' || coalesce(club_id::text, '∅') || '|' || coalesce(team_id::text, '∅')
     from media_albums where mission_id = (select id from m where k = 'ponctuelle')));
select pg_temp.note('équipe connue seulement par son nom sur la mission : retrouvée', '1 créée(s) / 1', pg_temp.creer('f9f9f9f9-0000-0000-0000-000000000001', 'par_nom'));
select pg_temp.note('rattachée à la bonne équipe', 'ZZ Séniors', (select (select name from club_teams where id = a.team_id) from media_albums a where a.mission_id = (select id from m where k = 'par_nom')));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
