-- Le parent invité par le club arrive dans son espace (v173, 12/09/2026).
--
-- Ce que ce test tient pour vrai : accepter une invitation de parent crée le profil parent, le
-- rattachement confirmé, ET règle le compte sur « particulier ». Sans ce dernier point, la
-- personne ouvre l'Espace joueur, qui n'a rien à lui montrer.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('d3d3d3d3-0000-0000-0000-000000000001','zz-inv-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Invitation (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Invitation (test)', id, 'performance' from cli returning id),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select id, 'QA', 'Enfant invite', date '2014-09-09', 'actif' from clu returning id, club_id),
       i as (insert into parent_invitations (club_id, player_id, email, prenom, nom, statut)
             select club_id, id, 'zz-inv-parent@example.invalid', 'QA', 'Parent invite', 'envoyee' from j returning id)
  select (select id from i) invitation, (select id from j) player_id;
grant select on ctx to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select pg_temp.note('avant acceptation, aucun réglage de compte', '∅',
  coalesce((select account_type from connect_profile_settings where user_id = 'd3d3d3d3-0000-0000-0000-000000000001'), '∅'));

select set_config('request.jwt.claims', '{"sub":"d3d3d3d3-0000-0000-0000-000000000001","email":"zz-inv-parent@example.invalid","role":"authenticated"}', true);
set local role authenticated;
select accept_parent_invitation((select invitation from ctx));
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select pg_temp.note('le compte est réglé sur « particulier »', 'particulier',
  (select account_type from connect_profile_settings where user_id = 'd3d3d3d3-0000-0000-0000-000000000001'));
select pg_temp.note('et le profil dit « parent »', 'parent',
  (select profil_particulier from connect_profile_settings where user_id = 'd3d3d3d3-0000-0000-0000-000000000001'));
select pg_temp.note('le rattachement à l''enfant est confirmé', 'confirme',
  (select ppr.statut from parent_player_relationships ppr, ctx where ppr.player_id = ctx.player_id));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
