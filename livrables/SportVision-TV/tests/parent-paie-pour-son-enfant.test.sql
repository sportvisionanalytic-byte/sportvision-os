-- Un parent réserve, paie, et retrouve sa commande (v199, 12/09/2026).
--
-- Le parcours était coupé au milieu. La réservation passait, parce que la fonction qui résout le
-- bénéficiaire connaît le cas « club ». Le paiement, lui, appelait
-- `connect_particulier_can_pay_client`, qui ne connaissait que self / managed / linked : 403. Et
-- la commande n'apparaissait ni dans les commandes ni dans les factures du parent, parce que
-- `connect_client_ids_for_caller` n'avait pas non plus de branche parentale.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('eedd0000-0000-0000-0000-000000000001','zz-parent-paie@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cliClub as (insert into clients (nom, statut_relation) values ('ZZ Club Paiement (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Paiement (test)', id, 'free' from cliClub returning id),
       cliEnfant as (insert into clients (nom, statut_relation) values ('ZZ Enfant Client (test)','client') returning id),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, client_id)
                  select (select id from clu), 'Nina', 'ZZPaiement', date '2015-05-05', 'actif', (select id from cliEnfant)
                  returning id, client_id),
       par as (insert into parent_profiles (user_id, prenom, nom)
               values ('eedd0000-0000-0000-0000-000000000001','Parent','ZZPaiement') returning id),
       lien as (insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
                select (select id from par), (select id from enfant), 'confirme', now() returning player_id)
  select (select id from enfant) enfant, (select client_id from enfant) client_enfant;
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

select pg_temp.sous('eedd0000-0000-0000-0000-000000000001');

select pg_temp.note('le parent peut payer pour son enfant', 'oui',
  case when connect_particulier_can_pay_client((select client_enfant from ctx)) then 'oui' else 'NON' end);

select pg_temp.note('et la commande de son enfant lui est rattachee', 'oui',
  (select case when exists (
     select 1 from connect_client_ids_for_caller('commandes') c, ctx
      where c.client_id = ctx.client_enfant) then 'oui' else 'NON' end));

select pg_temp.note('ses factures aussi', 'oui',
  (select case when exists (
     select 1 from connect_client_ids_for_caller('factures') c, ctx
      where c.client_id = ctx.client_enfant) then 'oui' else 'NON' end));

select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
