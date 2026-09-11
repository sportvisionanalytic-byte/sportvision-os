-- Reprendre une ligne financière à son nom (v169, 12/09/2026).
--
-- Ce que ce test tient pour vrai : un Responsable Production ne peut pas se transporter une
-- rémunération déjà validée en changeant le titulaire de la ligne, et réattribuer une ligne à
-- quelqu'un d'autre remet son paiement à zéro.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('a9a9a9a9-0000-0000-0000-000000000001','zz-rea-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('a9a9a9a9-0000-0000-0000-000000000002','zz-rea-collegue@example.invalid','',now(),'authenticated','authenticated'),
  ('a9a9a9a9-0000-0000-0000-000000000003','zz-rea-tiers@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, email, prenom, nom, role, actif, niveau_operateur) values
  ('a9a9a9a9-0000-0000-0000-000000000001','zz-rea-prod@example.invalid','QA','Responsable production','prod',true,3),
  ('a9a9a9a9-0000-0000-0000-000000000002','zz-rea-collegue@example.invalid','QA','Collegue','photo',true,2),
  ('a9a9a9a9-0000-0000-0000-000000000003','zz-rea-tiers@example.invalid','QA','Tiers','photo',true,1)
on conflict (id) do update set role = excluded.role, actif = true, niveau_operateur = excluded.niveau_operateur;

insert into pole_affectations (pole_id, user_id, role_pole, actif)
select id, 'a9a9a9a9-0000-0000-0000-000000000001'::uuid, 'membre', true from poles where nom = 'Basket';
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Client Reattribution (test)','partenaire', id from poles where nom = 'Basket' returning id),
       p as (insert into prestations (client_id, pole_id, date_prestation, type_prestation, statut, source, format_mission)
             select id, (select id from poles where nom = 'Basket'), current_date + 3, 'match', 'équipe_affectée', 'interne', 'standard' from cli returning id),
       e as (insert into prestations_equipe (prestation_id, collaborateur_id, fonction, statut, remuneration, statut_paiement)
             select id, 'a9a9a9a9-0000-0000-0000-000000000002', 'photographe', 'acceptée', 500, 'validé' from p returning id)
  select (select id from p) prestation, (select id from e) ligne;
grant select on ctx to authenticated;

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

select pg_temp.note('la Production ne se met pas sur une ligne validée à 500 euros', 'refusé',
  pg_temp.essai('a9a9a9a9-0000-0000-0000-000000000001',
    'update prestations_equipe set collaborateur_id = auth.uid() where id = (select ligne from ctx) returning remuneration::text'));
select pg_temp.note('la ligne appartient toujours au collègue', 'a9a9a9a9-0000-0000-0000-000000000002',
  (select collaborateur_id::text from prestations_equipe pe, ctx where pe.id = ctx.ligne));
select pg_temp.note('et elle est toujours validée', 'validé',
  (select statut_paiement from prestations_equipe pe, ctx where pe.id = ctx.ligne));

select pg_temp.note('réattribuer à un tiers est possible', 'a9a9a9a9-0000-0000-0000-000000000003',
  pg_temp.essai('a9a9a9a9-0000-0000-0000-000000000001',
    'update prestations_equipe set collaborateur_id = ''a9a9a9a9-0000-0000-0000-000000000003'' where id = (select ligne from ctx) returning collaborateur_id::text'));
select pg_temp.note('mais le paiement repart à zéro', 'en_attente',
  (select statut_paiement from prestations_equipe pe, ctx where pe.id = ctx.ligne));
select pg_temp.note('et le recommandé est celui du nouveau titulaire', 'oui',
  (select case when montant_recommande is distinct from 500 then 'oui' else 'NON' end from prestations_equipe pe, ctx where pe.id = ctx.ligne));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
