-- Un opérateur voit avec qui il travaille, jamais combien ses collègues touchent (v143, 11/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • deux opérateurs acceptés sur la même mission se voient : prénom, nom, rôle, heure de RDV ;
--   • la fonction ne rend aucun montant (rémunération, frais, paiement) : les colonnes n'existent pas ;
--   • un opérateur qui n'est pas sur la mission n'y voit personne ;
--   • un collègue « à envoyer » (proposition pas encore partie) ou qui a refusé n'apparaît pas ;
--   • celui qui est encore « à envoyer » ne voit pas l'équipe ;
--   • mission annulée : plus personne ; sans compte : refusé.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e1e1e1e1-0000-0000-0000-000000000001','zz-coeq-a@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000002','zz-coeq-b@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000003','zz-coeq-c@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000004','zz-coeq-d@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000005','zz-coeq-e@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('e1e1e1e1-0000-0000-0000-000000000001','QA','Alpha','photo',true),
  ('e1e1e1e1-0000-0000-0000-000000000002','QA','Bravo','photo',true),
  ('e1e1e1e1-0000-0000-0000-000000000003','QA','Charlie','photo',true),
  ('e1e1e1e1-0000-0000-0000-000000000004','QA','Delta','photo',true),
  ('e1e1e1e1-0000-0000-0000-000000000005','QA','Echo','photo',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Coéquipiers (test)', 'partenaire') returning id),
       pre as (insert into prestations (client_id, date_prestation, heure_debut, lieu, type_prestation, statut, source)
               select id, current_date + 3, '09:30', 'Stade ZZ', 'match', 'planifiée', 'interne' from cli returning id)
  select (select id from pre) mission;
grant select on ctx to authenticated;
-- A et B acceptés ; D encore « à envoyer » ; E a refusé ; C n'est pas sur la mission.
insert into prestations_equipe (prestation_id, collaborateur_id, statut, remuneration, heure_rdv)
select ctx.mission, v.uid, v.st::statut_affectation, v.remu, v.rdv
  from ctx, (values ('e1e1e1e1-0000-0000-0000-000000000001'::uuid, 'acceptée', 60, '09:10'::time),
                    ('e1e1e1e1-0000-0000-0000-000000000002'::uuid, 'acceptée', 45, '09:20'::time),
                    ('e1e1e1e1-0000-0000-0000-000000000004'::uuid, 'a_envoyer', 50, null),
                    ('e1e1e1e1-0000-0000-0000-000000000005'::uuid, 'refusée', 50, null)) v(uid, st, remu, rdv);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.lu(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin execute p_sql into v;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;
create or replace function pg_temp.equipe(p_uid uuid) returns text language sql as $$
  select pg_temp.lu('authenticated', p_uid,
    'select string_agg(nom || '':'' || role || '':'' || coalesce(to_char(heure_rdv, ''HH24:MI''), ''∅''), '','' order by nom)
       from mes_coequipiers(array[' || quote_literal((select mission from ctx)) || '::uuid])'); $$;

select pg_temp.note('A voit B (nom, rôle, RDV), ni D « à envoyer » ni E qui a refusé', 'Bravo:photo:09:20', pg_temp.equipe('e1e1e1e1-0000-0000-0000-000000000001'));
select pg_temp.note('B voit A', 'Alpha:photo:09:10', pg_temp.equipe('e1e1e1e1-0000-0000-0000-000000000002'));
select pg_temp.note('C, pas sur la mission, ne voit personne', '∅', pg_temp.equipe('e1e1e1e1-0000-0000-0000-000000000003'));
select pg_temp.note('D, pas encore proposé, ne voit pas l''équipe', '∅', pg_temp.equipe('e1e1e1e1-0000-0000-0000-000000000004'));
select pg_temp.note('aucun montant dans ce que rend la fonction', '0',
  (select count(*)::text from pg_proc p, unnest(p.proargnames) a
    where p.proname = 'mes_coequipiers' and a ~ '(remun|montant|frais|paiement|km|salaire|iban)'));
select pg_temp.note('sans compte : refusé', 'refusé',
  left(pg_temp.lu('anon', null, 'select count(*)::text from mes_coequipiers(array[' || quote_literal((select mission from ctx)) || '::uuid])'), 6));
update prestations set statut = 'annulée' where id = (select mission from ctx);
select pg_temp.note('mission annulée : plus personne', '∅', pg_temp.equipe('e1e1e1e1-0000-0000-0000-000000000001'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
