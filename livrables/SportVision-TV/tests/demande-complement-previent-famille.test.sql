-- « Demander un complément » arrive vraiment chez la famille (v205, 12/09/2026).
--
-- Le bouton du club écrivait une ligne dans `membership_request_events`, et rien d'autre. Aucun
-- lecteur de cette table dans tout le dépôt : la note (« il manque le certificat médical ») n'était
-- relue ni par le club, ni par la famille, ni par le CM. Le président demandait, l'écran
-- confirmait, il attendait, et personne n'avait rien reçu. Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee22aa00-0000-0000-0000-000000000001','zz-president-info@example.invalid','',now(),'authenticated','authenticated'),
  ('ee22aa00-0000-0000-0000-000000000002','zz-famille-info@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Complement (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Complement (test)', id, 'performance' from cli returning id),
       adm as (insert into club_members (club_id, user_id, role, status)
               select id, 'ee22aa00-0000-0000-0000-000000000001', 'admin', 'actif' from clu returning club_id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 complement' from clu returning id, club_id),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
                  select club_id, 'Eva', 'ZZComplement', date '2014-03-03', 'sans_compte' from eq returning id, club_id),
       dem as (insert into membership_requests (club_id, team_id, player_id, requested_by_user_id, statut, source)
               select (select club_id from enfant), (select id from eq), (select id from enfant),
                      'ee22aa00-0000-0000-0000-000000000002', 'a_verifier', 'spontanee' returning id)
  select (select id from dem) demande;
grant select on ctx to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

select pg_temp.sous('ee22aa00-0000-0000-0000-000000000001');
select request_membership_info((select demande from ctx), 'Il manque le certificat médical.');
select pg_temp.stop();

select pg_temp.note('la famille est prevenue', '1',
  (select count(*)::text from member_notifications
    where user_id = 'ee22aa00-0000-0000-0000-000000000002'));
select pg_temp.note('et elle lit ce que le club a ecrit', 'Il manque le certificat médical.',
  coalesce((select body from member_notifications
             where user_id = 'ee22aa00-0000-0000-0000-000000000002' limit 1), 'RIEN'));
select pg_temp.note('la trace reste dans l''historique', '1',
  (select count(*)::text from membership_request_events e, ctx
    where e.request_id = ctx.demande and e.event_type = 'info_demandee'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
