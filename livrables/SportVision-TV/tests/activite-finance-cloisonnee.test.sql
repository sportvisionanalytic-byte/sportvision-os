-- Le fil d'activité ne montre l'argent qu'à ceux qui ont le droit de le voir (v144, 11/09/2026).
--
-- Le fil d'activité recopie chaque mouvement financier, montant compris (rémunération d'un
-- opérateur, facture, avoir, provision d'impôt). Il était lisible par admin, secrétariat,
-- comptabilité, commercial et Production, sans distinction : le commercial lisait toutes les
-- rémunérations, la Production celles de tous les pôles et la finance de la société.
--
-- Ce que ce test tient pour vrai :
--   • admin, secrétariat, comptabilité : toute la finance du fil, comme avant ;
--   • Production : les lignes de mission (prix, rémunérations) de SON pôle, rien d'autre ;
--   • commercial : aucune ligne finance ;
--   • ce qui n'est pas de la finance (recrutement, signature) n'est pas touché par cette règle.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f2f2f2f2-0000-0000-0000-000000000001','zz-act-admin@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000002','zz-act-sec@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000003','zz-act-compta@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000004','zz-act-com@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000005','zz-act-prod-basket@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000006','zz-act-prod-foot@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('f2f2f2f2-0000-0000-0000-000000000001','QA','Admin','admin',true),
  ('f2f2f2f2-0000-0000-0000-000000000002','QA','Sec','sec',true),
  ('f2f2f2f2-0000-0000-0000-000000000003','QA','Compta','compta',true),
  ('f2f2f2f2-0000-0000-0000-000000000004','QA','Com','com',true),
  ('f2f2f2f2-0000-0000-0000-000000000005','QA','Prod Basket','prod',true),
  ('f2f2f2f2-0000-0000-0000-000000000006','QA','Prod Foot','prod',true)
on conflict (id) do update set role = excluded.role;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select (select id from poles where nom = 'Basket'), 'f2f2f2f2-0000-0000-0000-000000000005'::uuid, 'membre', true union all
select (select id from poles where nom = 'Football'), 'f2f2f2f2-0000-0000-0000-000000000006'::uuid, 'membre', true;

-- Une mission du pôle Basket, un opérateur payé 77 € ; puis une facture et une candidature.
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation, pole_id)
               select 'ZZ Club Activité (test)', 'partenaire', id from poles where nom = 'Basket' returning id),
       pre as (insert into prestations (client_id, pole_id, date_prestation, heure_debut, lieu, type_prestation, statut, source)
               select cli.id, (select id from poles where nom = 'Basket'), current_date + 4, '09:30', 'Stade ZZ', 'match', 'planifiée', 'interne' from cli returning id)
  select (select id from pre) mission;
grant select on ctx to authenticated;
insert into prestations_equipe (prestation_id, collaborateur_id, statut, remuneration)
select mission, 'f2f2f2f2-0000-0000-0000-000000000005'::uuid, 'acceptée', 77 from ctx;
insert into activity_log (categorie, titre, description, entity_type, entity_id) values
  ('finance', 'creation — factures', 'Montant : 991.00 €', 'factures', gen_random_uuid()),
  ('recrutement', 'Nouvelle candidature — zz', 'ZZ Candidat', 'recruitment_application', null);
create temp table mes on commit drop as
  select a.id, case when a.entity_type = 'factures' then 'facture'
                    when a.entity_type = 'recruitment_application' then 'candidature'
                    else 'mission' end as quoi
    from activity_log a
   where a.created_at >= now() - interval '1 minute'
     and (a.entity_type = 'factures' and a.description = 'Montant : 991.00 €'
          or a.entity_type = 'recruitment_application' and a.description = 'ZZ Candidat'
          or a.entity_type = 'prestations_equipe' and a.entity_id in (select id from prestations_equipe where prestation_id = (select mission from ctx))
          or a.entity_type = 'prestations' and a.entity_id = (select mission from ctx));
grant select on mes to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
-- Ce que la personne lit du décor : « mission:oui facture:non ».
create or replace function pg_temp.lit(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select string_agg(q || ':' || case when vu then 'oui' else 'non' end, ' ' order by q) into v
    from (select m.quoi q, bool_or(exists (select 1 from activity_log a where a.id = m.id)) vu from mes m where m.quoi <> 'candidature' group by m.quoi) x;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('décor : la rémunération est bien passée dans le fil', 'oui',
  (select case when exists (select 1 from mes where quoi = 'mission') then 'oui' else 'non' end));
select pg_temp.note('admin : toute la finance', 'facture:oui mission:oui', pg_temp.lit('f2f2f2f2-0000-0000-0000-000000000001'));
select pg_temp.note('secrétariat : toute la finance', 'facture:oui mission:oui', pg_temp.lit('f2f2f2f2-0000-0000-0000-000000000002'));
select pg_temp.note('comptabilité : toute la finance', 'facture:oui mission:oui', pg_temp.lit('f2f2f2f2-0000-0000-0000-000000000003'));
select pg_temp.note('commercial : aucune ligne finance', 'facture:non mission:non', pg_temp.lit('f2f2f2f2-0000-0000-0000-000000000004'));
select pg_temp.note('Production Basket : la mission de son pôle, pas la facture', 'facture:non mission:oui', pg_temp.lit('f2f2f2f2-0000-0000-0000-000000000005'));
select pg_temp.note('Production Football : ni la mission Basket ni la facture', 'facture:non mission:non', pg_temp.lit('f2f2f2f2-0000-0000-0000-000000000006'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
