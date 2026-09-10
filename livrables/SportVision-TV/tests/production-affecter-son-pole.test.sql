-- La Production peut affecter les collaborateurs de son pôle (migration v134, 10/09/2026).
--
-- Ce que ce test tient pour vrai : la requête exacte de l'OS (profils + leurs affectations de
-- pôle, filtrés sur le pôle de la mission) rend à la Production les photographes de son pôle,
-- et pas ceux d'un autre pôle ; un photographe, lui, ne voit toujours que sa propre affectation.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b8b8b8b8-0000-0000-0000-000000000001','zz-aff-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('b8b8b8b8-0000-0000-0000-000000000002','zz-aff-photo-foot@example.invalid','',now(),'authenticated','authenticated'),
  ('b8b8b8b8-0000-0000-0000-000000000003','zz-aff-photo-basket@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('b8b8b8b8-0000-0000-0000-000000000001','QA','Prod','prod',true),
  ('b8b8b8b8-0000-0000-0000-000000000002','QA','PhotoFoot','photo',true),
  ('b8b8b8b8-0000-0000-0000-000000000003','QA','PhotoBasket','photo',true)
on conflict (id) do update set role = excluded.role;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select (select id from poles where nom = 'Football'), 'b8b8b8b8-0000-0000-0000-000000000001'::uuid, 'membre', true union all
select (select id from poles where nom = 'Football'), 'b8b8b8b8-0000-0000-0000-000000000002'::uuid, 'membre', true union all
select (select id from poles where nom = 'Basket'), 'b8b8b8b8-0000-0000-0000-000000000003'::uuid, 'membre', true;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create temp table foot on commit drop as select id from poles where nom = 'Football';
grant select on foot to authenticated;

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

-- La requête de l'OS (modalEquipePrestation), filtrée comme l'écran sur le pôle de la mission.
insert into verdicts (controle, attendu, obtenu) values
 ('Production Football : le photographe Football est candidat', 'oui',
  pg_temp.lu('b8b8b8b8-0000-0000-0000-000000000001',
    'select case when exists (select 1 from profiles p join pole_affectations pa on pa.user_id = p.id
                              where p.id = ''b8b8b8b8-0000-0000-0000-000000000002'' and pa.pole_id = (select id from foot)) then ''oui'' else ''non'' end')),
 ('Production Football : le photographe Basket n''est pas candidat', 'non',
  pg_temp.lu('b8b8b8b8-0000-0000-0000-000000000001',
    'select case when exists (select 1 from pole_affectations pa where pa.user_id = ''b8b8b8b8-0000-0000-0000-000000000003'') then ''oui'' else ''non'' end')),
 ('photographe : ne voit que sa propre affectation', '1',
  pg_temp.lu('b8b8b8b8-0000-0000-0000-000000000002', 'select count(*)::text from pole_affectations'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
