-- Une mission regroupée compte pour UNE présence (migration v142, 11/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • trois matchs cochés le même jour au même stade (une mission, v133) plus un match dans un
--     autre stade (une autre mission) : la carte du mois du CM dit 2 présences prévues, pas 4 ;
--   • une fois la journée passée, 2 réalisées, pas 4 ;
--   • la rentabilité du mois (OS) compte 2 présences.
--
-- Décor fictif (« ZZ »), pôle sans Production réelle. Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('a8a8a8a8-0000-0000-0000-000000000001','zz-compte-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('a8a8a8a8-0000-0000-0000-000000000002','zz-compte-prod@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('a8a8a8a8-0000-0000-0000-000000000001','QA','CM','cm'),
  ('a8a8a8a8-0000-0000-0000-000000000002','QA','Production','prod')
on conflict (id) do update set role = excluded.role;

-- Un jour du mois en cours, dans le futur si possible (le CM décide sur un match à venir).
create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id, cm_id)
               select 'ZZ Club Comptage (test)', 'partenaire', id, 'a8a8a8a8-0000-0000-0000-000000000001' from pole returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Comptage (test)', id from cli returning id)
  select (select id from pole) pole_id, (select id from cli) client_id, (select id from clu) club_id,
         case when current_date + 2 <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date
              then current_date + 2 else current_date end as j;
grant select on ctx to authenticated;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'a8a8a8a8-0000-0000-0000-000000000001'::uuid, 'principal', current_date - 1, true from ctx;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'a8a8a8a8-0000-0000-0000-000000000002'::uuid, 'membre', true from ctx;

create temp table m (cle text primary key, id uuid) on commit drop;
grant select on m to authenticated;
create temp table decor (k text, equipe text, h time, lieu text) on commit drop;
insert into decor values
  ('u10a', 'ZZ U10 A', '09:30', 'Stade Claude Ripert'),
  ('u10b', 'ZZ U10 B', '10:30', 'Stade Claude Ripert'),
  ('u10c', 'ZZ U10 C', '11:00', 'Stade Claude Ripert'),
  ('autre', 'ZZ U12', '15:00', 'Gymnase Nord');
insert into club_matches (club_id, team, opponent, match_date, kickoff_time, lieu)
select ctx.club_id, d.equipe, 'ZZ Adversaire ' || d.k, ctx.j, d.h, d.lieu from ctx, decor d;
insert into m select d.k, cm.id from decor d join club_matches cm on cm.team = d.equipe and cm.club_id = (select club_id from ctx);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.comme(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql into v;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  return v;
end $$;
create or replace function pg_temp.mois_cm() returns text language sql as $$
  select pg_temp.comme('a8a8a8a8-0000-0000-0000-000000000001',
    'select (cm_tableau_de_bord(' || quote_literal((select club_id from ctx)) || '::uuid)->''mois''->>''presences_prevues'') || ''/'' || '
    || '(cm_tableau_de_bord(' || quote_literal((select club_id from ctx)) || '::uuid)->''mois''->>''presences_realisees'')'); $$;

-- ── Le CM coche les quatre matchs ──
select pg_temp.comme('a8a8a8a8-0000-0000-0000-000000000001',
  'select string_agg(cm_definir_couverture(''match:'' || id, ''photo_video'')::text, '','') from m');
select pg_temp.note('4 matchs couverts, 2 missions (3 au même stade + 1 ailleurs)', '4/2',
  (select count(*)::text || '/' || count(distinct created_prestation_id)::text from planned_presences
    where match_id in (select id from m) and statut <> 'annule'));

-- ── La carte du mois du CM ──
select pg_temp.note('carte du mois du CM : 2 prévues, 0 réalisée', '2/0', pg_temp.mois_cm());

-- ── La rentabilité du mois (OS) ──
select pg_temp.note('rentabilité du mois : 2 présences', '2',
  pg_temp.comme('a8a8a8a8-0000-0000-0000-000000000002',
    'select rentabilite_club_mois(' || quote_literal((select club_id from ctx)) || '::uuid, current_date)->>''presences'''));

-- ── La journée passée : 2 réalisées ──
-- Ramenée au premier jour du mois ; le 1er du mois, rien n'est encore passé dans le mois.
update planned_presences set date_presence = date_trunc('month', current_date)::date
 where match_id in (select id from m);
select pg_temp.note('journée passée : 2 prévues, 2 réalisées', case when extract(day from current_date) > 1 then '2/2' else '2/0' end, pg_temp.mois_cm());

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
