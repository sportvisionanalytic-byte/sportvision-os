-- Le CM voit les prochaines venues de SportVision dans ses clubs, sans les prix (v146, 11/09/2026).
--
-- L'accueil CM de l'OS a une carte « Prestations à venir (14 j) » et un bloc « Prochaines
-- prestations ». Aucune policy ne donne au CM la lecture des missions (elles portent les prix) :
-- les deux restaient vides pour tous les CM. cm_prestations_a_venir rend date, heure, lieu, type,
-- statut et club, rien d'autre.
--
-- Ce que ce test tient pour vrai :
--   • le CM voit la mission de son club dans les 14 jours ;
--   • ni celle d'un club qui n'est pas le sien, ni une mission annulée, ni une au-delà de 14 jours ;
--   • aucune colonne d'argent dans le résultat ;
--   • un photographe n'y voit rien ; sans compte : refusé.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f3f3f3f3-0000-0000-0000-000000000001','zz-cmpre-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('f3f3f3f3-0000-0000-0000-000000000002','zz-cmpre-photo@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('f3f3f3f3-0000-0000-0000-000000000001','QA','CM','cm',true),
  ('f3f3f3f3-0000-0000-0000-000000000002','QA','Photo','photo',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with ca as (insert into clients (nom, statut_relation) values ('ZZ Club A (test)', 'partenaire') returning id),
       cb as (insert into clients (nom, statut_relation) values ('ZZ Club B (test)', 'partenaire') returning id),
       ka as (insert into clubs (nom, portail_client_id) select 'ZZ Club A (test)', id from ca returning id),
       kb as (insert into clubs (nom, portail_client_id) select 'ZZ Club B (test)', id from cb returning id)
  select (select id from ca) client_a, (select id from cb) client_b, (select id from ka) club_a, (select id from kb) club_b;
grant select on ctx to authenticated;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_a, 'f3f3f3f3-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date - 1, true from ctx;
insert into prestations (client_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, montant_ht, description_besoin)
select case v.club when 'A' then ctx.client_a else ctx.client_b end, current_date + v.j, '09:30'::time, v.lieu, 'match',
       v.st::statut_prestation, 'interne', 200, v.nom
  from ctx, (values ('A', 3, 'Stade A', 'planifiée', 'ZZ-A-proche'), ('A', 20, 'Stade A', 'planifiée', 'ZZ-A-loin'),
                    ('A', 4, 'Stade A', 'annulée', 'ZZ-A-annulee'), ('B', 3, 'Stade B', 'planifiée', 'ZZ-B-proche')) v(club, j, lieu, st, nom);

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
-- Ce que la personne voit du décor (les clubs ZZ A et B), sous la forme « club:lieu:heure ».
create or replace function pg_temp.voit(p_uid uuid) returns text language sql as $$
  select pg_temp.lu('authenticated', p_uid,
    'select string_agg(club_nom || '':'' || lieu || '':'' || to_char(heure_debut, ''HH24:MI''), '','' order by club_nom)
       from cm_prestations_a_venir(14) where club_nom like ''ZZ Club %'''); $$;

select pg_temp.note('le CM voit la mission de son club, dans les 14 jours, et elle seule', 'ZZ Club A (test):Stade A:09:30',
  pg_temp.voit('f3f3f3f3-0000-0000-0000-000000000001'));
select pg_temp.note('aucune colonne d''argent dans le résultat', '0',
  (select count(*)::text from pg_proc p, unnest(p.proargnames) a
    where p.proname = 'cm_prestations_a_venir' and a ~ '(montant|prix|remun|marge|tarif|ht|ttc)'));
select pg_temp.note('un photographe n''y voit rien', '∅', pg_temp.voit('f3f3f3f3-0000-0000-0000-000000000002'));
select pg_temp.note('sans compte : refusé', 'refusé',
  left(pg_temp.lu('anon', null, 'select count(*)::text from cm_prestations_a_venir(14)'), 6));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
