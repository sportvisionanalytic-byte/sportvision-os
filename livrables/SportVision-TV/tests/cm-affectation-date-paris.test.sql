-- Une affectation de CM compte en jours de Paris, pas en jours UTC (v153, 11/09/2026).
--
-- Constaté le 11/09 : une affectation posée à 1 h du matin, datée du jour (Paris), n'ouvrait le club
-- au CM qu'à 2 h, parce que la base comparait date_debut à current_date en UTC. Le test évalue la
-- même affectation (du jour au jour, à Paris) sous deux fuseaux de session extrêmes : l'ancienne
-- règle échoue toujours dans l'un des deux, quelle que soit l'heure ; la nouvelle doit réussir
-- dans les deux. Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f8f8f8f8-0000-0000-0000-000000000001','zz-tz-cm@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values ('f8f8f8f8-0000-0000-0000-000000000001','QA','CM','cm',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Fuseau (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Fuseau (test)', id from cli returning id)
  select (select id from clu) club_id, (now() at time zone 'Europe/Paris')::date as jour_paris;
grant select on ctx to authenticated;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, date_fin, actif)
select club_id, 'f8f8f8f8-0000-0000-0000-000000000001'::uuid, 'secondaire', jour_paris, jour_paris, true from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.voit(p_tz text) returns text language plpgsql as $$
declare v text;
begin
  execute format('set local timezone = %L', p_tz);
  perform set_config('request.jwt.claims', '{"sub":"f8f8f8f8-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select case when (select club_id from ctx) in (select cm_clubs_autorises()) then 'oui' else 'non' end
         || '/' || case when exists (select 1 from cm_espaces_clubs() e where e.club_id = (select club_id from ctx)) then 'oui' else 'non' end
    into v;
  execute 'reset role';
  execute 'set local timezone = ''UTC''';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('session à UTC−12 : le club est ouvert au CM (autorisés / espaces)', 'oui/oui', pg_temp.voit('Etc/GMT+12'));
select pg_temp.note('session à UTC+14 : le club est ouvert au CM (autorisés / espaces)', 'oui/oui', pg_temp.voit('Etc/GMT-14'));
select pg_temp.note('session à UTC : le club est ouvert au CM', 'oui/oui', pg_temp.voit('UTC'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
