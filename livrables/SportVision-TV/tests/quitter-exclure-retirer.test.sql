-- On peut sortir : d'un groupe, d'un lien parental, d'une équipe (v184, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • un membre quitte un groupe, le créateur en exclut un autre, et personne d'autre ne le peut ;
--   • le créateur ne peut pas quitter son propre groupe (il en retire les membres) ;
--   • un lien parent confirmé se retire par le club, par le parent, et par personne d'autre ;
--   • un joueur se retire d'une équipe par un dirigeant ou par l'éducateur de cette équipe.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('dd33dd33-0000-0000-0000-000000000001','zz-sortie-createur@example.invalid','',now(),'authenticated','authenticated'),
  ('dd33dd33-0000-0000-0000-000000000002','zz-sortie-membre@example.invalid','',now(),'authenticated','authenticated'),
  ('dd33dd33-0000-0000-0000-000000000003','zz-sortie-tiers@example.invalid','',now(),'authenticated','authenticated'),
  ('dd33dd33-0000-0000-0000-000000000004','zz-sortie-president@example.invalid','',now(),'authenticated','authenticated'),
  ('dd33dd33-0000-0000-0000-000000000005','zz-sortie-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom)
values ('dd33dd33-0000-0000-0000-000000000005','dd33dd33-0000-0000-0000-000000000005','QA','Parent sortie') on conflict (id) do nothing;

create temp table ctx on commit drop as
  with g as (insert into user_groups (name, created_by) values ('ZZ Groupe sortie (test)','dd33dd33-0000-0000-0000-000000000001') returning id),
       cli as (insert into clients (nom, statut_relation) values ('ZZ Club Sortie (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Sortie (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U11 sortie' from clu returning id, club_id),
       sa as (select id from saisons order by date_debut desc limit 1),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select club_id, 'QA', 'Enfant sortie', date '2015-03-03', 'actif' from eq returning id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select eq.id, j.id, eq.club_id, (select id from sa), '2026-2027', 'active' from eq, j returning player_id),
       r as (insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
             select 'dd33dd33-0000-0000-0000-000000000005', j.id, 'parent', 'confirme', now() from j returning id)
  select (select id from g) groupe, (select id from eq) equipe, (select id from j) player_id,
         (select club_id from eq) club_id, (select id from r) relation;
grant select on ctx to authenticated;
insert into user_group_members (group_id, user_id, role)
select groupe, 'dd33dd33-0000-0000-0000-000000000001'::uuid, 'createur' from ctx union all
select groupe, 'dd33dd33-0000-0000-0000-000000000002'::uuid, 'membre' from ctx union all
select groupe, 'dd33dd33-0000-0000-0000-000000000003'::uuid, 'membre' from ctx;
insert into club_members (user_id, club_id, role, status, teams)
select 'dd33dd33-0000-0000-0000-000000000004'::uuid, club_id, 'president', 'actif', '[]'::jsonb from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.essai(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v; exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;

-- Le groupe.
select pg_temp.note('un membre quitte le groupe', 'true',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000002', 'select (quitter_groupe((select groupe from ctx))->>''sorti'')'));
select pg_temp.note('le créateur ne quitte pas son propre groupe', 'refusé',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000001', 'select (quitter_groupe((select groupe from ctx))->>''sorti'')'));
select pg_temp.note('un membre n''exclut personne', 'refusé',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000003',
    'select (exclure_du_groupe((select groupe from ctx), ''dd33dd33-0000-0000-0000-000000000001'')->>''retires'')'));
select pg_temp.note('le créateur exclut un membre', '1',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000001',
    'select (exclure_du_groupe((select groupe from ctx), ''dd33dd33-0000-0000-0000-000000000003'')->>''retires'')'));
select pg_temp.note('il ne reste que le créateur', '1',
  (select count(*)::text from user_group_members m, ctx where m.group_id = ctx.groupe));

-- Le lien parental.
select pg_temp.note('un tiers ne retire pas le lien parental', 'refusé',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000003',
    'select (retirer_lien_parent((select relation from ctx))->>''retire'')'));
select pg_temp.note('le président du club le retire', 'true',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000004',
    'select (retirer_lien_parent((select relation from ctx), ''erreur de rattachement'')->>''retire'')'));
select pg_temp.note('le parent n''a plus accès à l''enfant', 'false',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000005',
    'select is_confirmed_parent_of((select player_id from ctx))::text'));

-- L'équipe.
select pg_temp.note('un tiers ne retire pas un joueur de l''équipe', 'refusé',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000003',
    'select (retirer_joueur_equipe((select player_id from ctx), (select equipe from ctx))->>''retires'')'));
select pg_temp.note('le président retire le joueur de l''équipe', '1',
  pg_temp.essai('dd33dd33-0000-0000-0000-000000000004',
    'select (retirer_joueur_equipe((select player_id from ctx), (select equipe from ctx))->>''retires'')'));
select pg_temp.note('l''effectif ne le compte plus', 'quittee_equipe',
  (select statut from team_memberships tm, ctx where tm.player_id = ctx.player_id));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
