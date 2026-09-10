-- Un kit s'attribue à la mission et revient à son opérateur (migration v135, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la Production attribue un kit sans choisir d'opérateur ;
--   • il revient à l'opérateur dès qu'il est le seul affecté, et l'opérateur le voit ;
--   • l'opérateur accepte sa mission sans que le rattachement ne la fasse échouer ;
--   • un opérateur qui refuse rend le kit à la mission ; à deux opérateurs, il reste à la mission.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('c9c9c9c9-0000-0000-0000-000000000001','zz-kit-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('c9c9c9c9-0000-0000-0000-000000000002','zz-kit-photo1@example.invalid','',now(),'authenticated','authenticated'),
  ('c9c9c9c9-0000-0000-0000-000000000003','zz-kit-photo2@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('c9c9c9c9-0000-0000-0000-000000000001','QA','Prod','prod',true),
  ('c9c9c9c9-0000-0000-0000-000000000002','QA','Photo 1','photo',true),
  ('c9c9c9c9-0000-0000-0000-000000000003','QA','Photo 2','photo',true)
on conflict (id) do update set role = excluded.role;

create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Club Kits (test)', 'partenaire', id from pole returning id)
  select (select id from pole) pole_id, (select id from cli) client_id;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'c9c9c9c9-0000-0000-0000-000000000001'::uuid, 'membre', true from ctx;
create temp table obj (cle text primary key, id uuid) on commit drop;
grant select, insert on obj to authenticated;
with k as (insert into kits (nom, type_kit, statut) values ('ZZ Kit A', 'Photo', 'disponible'), ('ZZ Kit B', 'Photo', 'disponible'), ('ZZ Kit C', 'Photo', 'disponible') returning id, nom)
insert into obj select nom, id from k;
with p as (insert into prestations (client_id, date_prestation, type_prestation, statut, source, montant_ht)
           select client_id, current_date + 6 + g, 'match', 'planifiée', 'interne', 100 from ctx, generate_series(0, 2) g returning id, date_prestation)
insert into obj select 'mission' || row_number() over (order by date_prestation), id from p;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql; exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v; exception when others then v := 'erreur : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, 'nul');
end $$;
create or replace function pg_temp.titulaire(p_kit text) returns text language sql as $$
  select coalesce((select case when collaborateur_id is null then 'mission' when collaborateur_id = 'c9c9c9c9-0000-0000-0000-000000000002' then 'photo1'
                                               when collaborateur_id = 'c9c9c9c9-0000-0000-0000-000000000003' then 'photo2' else 'autre' end
                     from kit_reservations where kit_id = (select id from obj where cle = p_kit) and statut <> 'retourné'), 'mission'); $$;
create or replace function pg_temp.kit(p_kit text, p_mission text) returns text language sql as $$
  select pg_temp.fait('c9c9c9c9-0000-0000-0000-000000000001',
    'insert into kit_reservations (kit_id, prestation_id, collaborateur_id, statut) values (''' || (select id from obj where cle = p_kit) || ''', ''' || (select id from obj where cle = p_mission) || ''', null, ''réservé'')'); $$;
create or replace function pg_temp.affecter(p_photo text, p_mission text) returns text language sql as $$
  select pg_temp.fait('c9c9c9c9-0000-0000-0000-000000000001',
    'select rpc_ajouter_membre_equipe(''' || (select id from obj where cle = p_mission) || ''', ''' || p_photo || ''', ''Photo'', null, null, 55, 3::smallint, 55, 1, 55, null, null)'); $$;

-- ── Mission 1 : kit d'abord, opérateur ensuite, qui accepte ──
insert into verdicts (controle, attendu, obtenu) values ('Production : attribuer le kit A sans opérateur', 'autorisé', pg_temp.kit('ZZ Kit A', 'mission1'));
insert into verdicts (controle, attendu, obtenu) values ('le kit A est à la mission', 'mission', pg_temp.titulaire('ZZ Kit A'));
insert into verdicts (controle, attendu, obtenu) values ('Production : affecter l''opérateur 1', 'autorisé', pg_temp.affecter('c9c9c9c9-0000-0000-0000-000000000002', 'mission1'));
insert into verdicts (controle, attendu, obtenu) values ('le kit A revient à l''opérateur 1, seul affecté', 'photo1', pg_temp.titulaire('ZZ Kit A'));
insert into verdicts (controle, attendu, obtenu) values ('opérateur 1 : accepter la mission', 'autorisé',
  pg_temp.fait('c9c9c9c9-0000-0000-0000-000000000002', 'update prestations_equipe set statut = ''acceptée'', date_reponse = now() where prestation_id = ''' || (select id from obj where cle = 'mission1') || ''''));
insert into verdicts (controle, attendu, obtenu) values ('l''acceptation est enregistrée', 'acceptée',
  (select statut::text from prestations_equipe where prestation_id = (select id from obj where cle = 'mission1')));
insert into verdicts (controle, attendu, obtenu) values ('opérateur 1 : voit son kit', '1',
  pg_temp.lu('c9c9c9c9-0000-0000-0000-000000000002', 'select count(*)::text from kit_reservations where collaborateur_id = auth.uid()'));

-- ── Mission 2 : opérateur invité, kit attribué, puis l'opérateur refuse ──
insert into verdicts (controle, attendu, obtenu) values ('Production : affecter l''opérateur 2 puis le kit B', 'autorisé/autorisé',
  pg_temp.affecter('c9c9c9c9-0000-0000-0000-000000000003', 'mission2') || '/' || pg_temp.kit('ZZ Kit B', 'mission2'));
update kit_reservations set collaborateur_id = 'c9c9c9c9-0000-0000-0000-000000000003'
 where kit_id = (select id from obj where cle = 'ZZ Kit B');  -- ce que fait l'écran : un seul opérateur, le kit est à lui
insert into verdicts (controle, attendu, obtenu) values ('opérateur 2 : refuser la mission', 'autorisé',
  pg_temp.fait('c9c9c9c9-0000-0000-0000-000000000003', 'update prestations_equipe set statut = ''refusée'', date_reponse = now() where prestation_id = ''' || (select id from obj where cle = 'mission2') || ''''));
insert into verdicts (controle, attendu, obtenu) values ('le kit B revient à la mission', 'mission', pg_temp.titulaire('ZZ Kit B'));

-- ── Mission 3 : deux opérateurs, le kit reste à la mission ──
select pg_temp.affecter('c9c9c9c9-0000-0000-0000-000000000002', 'mission3'), pg_temp.affecter('c9c9c9c9-0000-0000-0000-000000000003', 'mission3');
insert into verdicts (controle, attendu, obtenu) values ('deux opérateurs : kit C attribué', 'autorisé', pg_temp.kit('ZZ Kit C', 'mission3'));
insert into verdicts (controle, attendu, obtenu) values ('deux opérateurs : le kit C reste à la mission', 'mission', pg_temp.titulaire('ZZ Kit C'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
