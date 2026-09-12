-- Déclarer son enfant dans un club (v185, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • un parent qui déclare un enfant INCONNU du club crée sa fiche, et le lien est confirmé
--     tout de suite : c'est sa fiche à lui ;
--   • un parent qui déclare un enfant DÉJÀ CONNU du club ne crée pas de seconde fiche, et son
--     lien part en attente de confirmation, pour que le club tranche ;
--   • la demande d'adhésion porte bien sur la fiche existante.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee44ee44-0000-0000-0000-000000000001','zz-decl-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('ee44ee44-0000-0000-0000-000000000002','zz-decl-inconnu@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Declaration (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Declaration (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U9 declaration' from clu returning id, club_id),
       connu as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
                 select club_id, 'Lucas', 'Martin', date '2016-04-04', 'sans_compte' from eq returning id)
  select (select club_id from eq) club_id, (select id from eq) equipe, (select id from connu) connu;
grant select on ctx to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

-- 1. Un enfant que le club connaît déjà.
select pg_temp.sous('ee44ee44-0000-0000-0000-000000000001');
select request_team_membership_for_child((select club_id from ctx), (select equipe from ctx), 'lucas', 'MARTIN', date '2016-04-04');
select pg_temp.stop();

select pg_temp.note('aucune seconde fiche n''est créée', '1',
  (select count(*)::text from player_profiles p, ctx where p.club_id = ctx.club_id and p.nom ilike 'martin'));
select pg_temp.note('le lien parental attend la décision du club', 'en_attente_confirmation',
  (select ppr.statut from parent_player_relationships ppr, ctx where ppr.player_id = ctx.connu));
select pg_temp.note('la demande porte sur la fiche existante', 'oui',
  (select case when exists (select 1 from membership_requests m, ctx where m.player_id = ctx.connu) then 'oui' else 'NON' end));

-- 2. Un enfant inconnu du club.
select pg_temp.sous('ee44ee44-0000-0000-0000-000000000002');
select request_team_membership_for_child((select club_id from ctx), (select equipe from ctx), 'Zoe', 'Nouvelle', date '2017-05-05');
select pg_temp.stop();

select pg_temp.note('la fiche de l''enfant inconnu est créée', '1',
  (select count(*)::text from player_profiles p, ctx where p.club_id = ctx.club_id and p.nom = 'Nouvelle'));
select pg_temp.note('et son lien est confirmé tout de suite', 'confirme',
  (select ppr.statut from parent_player_relationships ppr
     join player_profiles p on p.id = ppr.player_id, ctx
    where p.club_id = ctx.club_id and p.nom = 'Nouvelle'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
