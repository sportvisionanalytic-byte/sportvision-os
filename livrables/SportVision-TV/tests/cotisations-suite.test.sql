-- Une cotisation collectée a une suite (v182, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • atteindre l'objectif prévient SportVision, une seule fois ;
--   • une cotisation expirée sous son objectif, avec de l'argent collecté, est signalée ;
--   • une participation déclarée en espèces peut être annulée par son auteur ou par
--     l'organisateur, et par personne d'autre ;
--   • l'annulation rouvre la cotisation et rend le solde disponible ;
--   • l'adresse d'un participant invité n'est plus lisible par les membres du groupe.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('cc11cc11-0000-0000-0000-000000000001','zz-cot-organisateur@example.invalid','',now(),'authenticated','authenticated'),
  ('cc11cc11-0000-0000-0000-000000000002','zz-cot-participant@example.invalid','',now(),'authenticated','authenticated'),
  ('cc11cc11-0000-0000-0000-000000000003','zz-cot-tiers@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with g as (insert into user_groups (name, created_by) values ('ZZ Groupe cotisation (test)', 'cc11cc11-0000-0000-0000-000000000001') returning id),
       f as (insert into group_fundings (group_id, created_by, catalogue_offre_id, titre, montant_cible, statut, repartition_mode)
             select g.id, 'cc11cc11-0000-0000-0000-000000000001', (select id from catalogue_offres order by nom limit 1),
                    'ZZ Cotisation test', 100, 'ouverte', 'libre' from g returning id)
  select (select id from g) groupe, (select id from f) funding;
grant select on ctx to authenticated;
insert into user_group_members (group_id, user_id)
select groupe, 'cc11cc11-0000-0000-0000-000000000001'::uuid from ctx union all
select groupe, 'cc11cc11-0000-0000-0000-000000000002'::uuid from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
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

-- Le participant déclare 100 € en espèces : l'objectif est atteint.
select pg_temp.note('la participation en espèces est enregistrée', '∅',
  case when pg_temp.essai('cc11cc11-0000-0000-0000-000000000002',
    'select (contribute_funding_especes((select funding from ctx), 100)->>''ok'')') = 'refusé' then 'refusé' else '∅' end);
select pg_temp.note('la cotisation passe à « objectif atteint »', 'objectif_atteint',
  (select statut from group_fundings f, ctx where f.id = ctx.funding));
select pg_temp.note('SportVision est prévenu', 'oui',
  (select case when staff_notifie_le is not null then 'oui' else 'NON' end from group_fundings f, ctx where f.id = ctx.funding));

-- Un tiers ne peut pas annuler cette participation.
select pg_temp.note('un tiers n''annule pas la participation d''un autre', 'refusé',
  pg_temp.essai('cc11cc11-0000-0000-0000-000000000003',
    'select annuler_contribution_especes((select id from funding_contributions where funding_id = (select funding from ctx) limit 1))::text'));

-- L'organisateur, lui, corrige l'erreur.
select pg_temp.note('l''organisateur annule une déclaration erronée', 'true',
  pg_temp.essai('cc11cc11-0000-0000-0000-000000000001',
    'select (annuler_contribution_especes((select id from funding_contributions where funding_id = (select funding from ctx) limit 1))->>''ok'')'));
select pg_temp.note('le solde redevient disponible', '0.00',
  (select montant_collecte::text from group_fundings f, ctx where f.id = ctx.funding));
select pg_temp.note('et la cotisation est rouverte', 'ouverte',
  (select statut from group_fundings f, ctx where f.id = ctx.funding));

-- Expiration sous l'objectif, avec de l'argent collecté.
insert into funding_contributions (funding_id, contributor_user_id, montant, statut, mode_paiement)
select funding, 'cc11cc11-0000-0000-0000-000000000002'::uuid, 30, 'paye', 'especes' from ctx;
update group_fundings set date_limite = current_date - 1 where id = (select funding from ctx);
select pg_temp.note('le rattrapage quotidien signale la cotisation expirée', 'oui',
  case when check_cotisations_a_traiter() >= 1 then 'oui' else 'NON' end);
select pg_temp.note('et elle n''est signalée qu''une fois', '0',
  check_cotisations_a_traiter()::text);

-- L'adresse d'un invité ne se lit plus. On en insère une vraie, sinon la colonne est vide et le
-- contrôle ne prouve rien.
insert into funding_contributions (funding_id, guest_prenom, guest_email, montant, statut, mode_paiement)
select funding, 'QA Invite', 'zz-invite@example.invalid', 10, 'paye', 'carte' from ctx;
select pg_temp.note('l''adresse d''un participant invité n''est plus lisible', 'refusé',
  pg_temp.essai('cc11cc11-0000-0000-0000-000000000002',
    'select coalesce(string_agg(guest_email, '',''), ''∅'') from funding_contributions where funding_id = (select funding from ctx)'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
