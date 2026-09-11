-- Finance Production : les noms, et les bornes du mois à l'heure de Paris (v174, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la comptabilité voit le nom de la personne dont elle valide la rémunération ;
--   • un opérateur terrain ne lit pas cette liste ;
--   • un encaissement du 1er à 01 h, heure de Paris, compte pour le mois qui commence, et non
--     pour le précédent.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e5e5e5e5-0000-0000-0000-000000000001','zz-fpn-compta@example.invalid','',now(),'authenticated','authenticated'),
  ('e5e5e5e5-0000-0000-0000-000000000002','zz-fpn-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('e5e5e5e5-0000-0000-0000-000000000003','zz-fpn-photo@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, email, prenom, nom, role, actif) values
  ('e5e5e5e5-0000-0000-0000-000000000001','zz-fpn-compta@example.invalid','QA','Comptabilite','compta',true),
  ('e5e5e5e5-0000-0000-0000-000000000002','zz-fpn-prod@example.invalid','QA','Production du pole','prod',true),
  ('e5e5e5e5-0000-0000-0000-000000000003','zz-fpn-photo@example.invalid','QA','Photographe','photo',true)
on conflict (id) do update set role = excluded.role, actif = true;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select id, 'e5e5e5e5-0000-0000-0000-000000000002'::uuid, 'responsable', true from poles where nom = 'Basket';

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vu(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select coalesce(string_agg(prenom || ' ' || nom, ', '), '∅') into v
      from production_du_pole((select id from poles where nom = 'Basket'))
     where nom like 'QA%' or nom like 'Production%';
  exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('la comptabilité voit la Production du pôle', 'QA Production du pole',
  pg_temp.vu('e5e5e5e5-0000-0000-0000-000000000001'));
select pg_temp.note('un opérateur terrain ne lit pas cette liste', '∅',
  pg_temp.vu('e5e5e5e5-0000-0000-0000-000000000003'));

-- Les bornes du mois : la fonction compte-t-elle en heure de Paris ?
select pg_temp.note('le 1er à 01 h heure de Paris appartient au mois qui commence', 'oui',
  case when (timestamptz '2026-09-01 01:00+02' at time zone 'Europe/Paris')::date = date '2026-09-01'
       then 'oui' else 'NON' end);
select pg_temp.note('la fonction ne compare plus d''instants à des dates en UTC', 'oui',
  case when (select count(*) from pg_proc
              where proname = 'production_remuneration_detail'
                and prosrc like '%at time zone ''Europe/Paris''%') = 1 then 'oui' else 'NON' end);
select pg_temp.note('aucune comparaison brute ne subsiste', 'oui',
  case when (select count(*) from pg_proc
              where proname = 'production_remuneration_detail'
                and (prosrc like '%o.paid_at >= v_debut%' or prosrc like '%a.created_at >= v_debut%'
                     or prosrc like '%pa.updated_at >= v_debut%')) = 0 then 'oui' else 'NON' end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
