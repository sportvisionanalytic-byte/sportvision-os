-- Les candidatures cloisonnées par rôle et par pôle (migration v130, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • l'administration voit tout ; la Production et le responsable de pôle, les candidatures
--     d'opérateurs terrain de leur pôle ; le secrétariat, les candidats retenus ; CM,
--     photographes, commerciaux et comptabilité, rien ;
--   • la même règle pour les CV stockés, le journal d'activité, la vue des documents du
--     secrétariat et la proposition à la Direction ;
--   • hors administration, seul le statut change ; le compte collaborateur se relie par
--     l'administration ou le secrétariat.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('c3c3c3c3-0000-0000-0000-000000000001','zz-rec-admin@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000002','zz-rec-prod-foot@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000003','zz-rec-prod-basket@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000004','zz-rec-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000005','zz-rec-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000006','zz-rec-sec@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000007','zz-rec-compta@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000008','zz-rec-com@example.invalid','',now(),'authenticated','authenticated'),
  ('c3c3c3c3-0000-0000-0000-000000000009','zz-rec-resp-basket@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('c3c3c3c3-0000-0000-0000-000000000001','QA','Admin','admin'),
  ('c3c3c3c3-0000-0000-0000-000000000002','QA','Prod Football','prod'),
  ('c3c3c3c3-0000-0000-0000-000000000003','QA','Prod Basket','prod'),
  ('c3c3c3c3-0000-0000-0000-000000000004','QA','Photo','photo'),
  ('c3c3c3c3-0000-0000-0000-000000000005','QA','CM','cm'),
  ('c3c3c3c3-0000-0000-0000-000000000006','QA','Sec','sec'),
  ('c3c3c3c3-0000-0000-0000-000000000007','QA','Compta','compta'),
  ('c3c3c3c3-0000-0000-0000-000000000008','QA','Commercial','com'),
  ('c3c3c3c3-0000-0000-0000-000000000009','QA','Responsable Basket','photo')
on conflict (id) do update set role = excluded.role;

create temp table ctx on commit drop as
  select (select id from poles where nom = 'Football') as foot, (select id from poles where nom = 'Basket') as basket;
do $$ begin
  if (select foot from ctx) is null or (select basket from ctx) is null then
    raise exception 'DÉCOR INVALIDE : il faut les pôles Football et Basket.';
  end if;
end $$;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select foot, 'c3c3c3c3-0000-0000-0000-000000000002'::uuid, 'membre', true from ctx union all
select foot, 'c3c3c3c3-0000-0000-0000-000000000006'::uuid, 'membre', true from ctx union all
select basket, 'c3c3c3c3-0000-0000-0000-000000000003'::uuid, 'membre', true from ctx union all
select basket, 'c3c3c3c3-0000-0000-0000-000000000009'::uuid, 'responsable', true from ctx;

-- Cinq candidatures : A terrain Football, B CM Football, C terrain Basket, D terrain sans pôle,
-- E photographe Football déjà retenu.
insert into recruitment_applications (id, source, poste, prenom, nom, email, statut, pole_id, cv_path)
select 'd4d4d4d4-0000-0000-0000-00000000000a'::uuid, 'photographe_videaste', 'les_deux', 'Alice', 'ZZ', 'zz-cand-a@example.invalid', 'nouveau', foot, 'recrutement-cv/zz-cand-a.pdf' from ctx union all
select 'd4d4d4d4-0000-0000-0000-00000000000b', 'community_manager', 'community_manager', 'Bruno', 'ZZ', 'zz-cand-b@example.invalid', 'nouveau', foot, 'recrutement-cv/zz-cand-b.pdf' from ctx union all
select 'd4d4d4d4-0000-0000-0000-00000000000c', 'photographe_videaste', 'les_deux', 'Chloé', 'ZZ', 'zz-cand-c@example.invalid', 'nouveau', basket, null from ctx union all
select 'd4d4d4d4-0000-0000-0000-00000000000d', 'photographe_videaste', 'les_deux', 'David', 'ZZ', 'zz-cand-d@example.invalid', 'nouveau', null, null from ctx union all
select 'd4d4d4d4-0000-0000-0000-00000000000e', 'photographe_videaste', 'photographe', 'Emma', 'ZZ', 'zz-cand-e@example.invalid', 'retenu', foot, null from ctx;
insert into storage.objects (bucket_id, name) values
  ('sportvision-media-prive', 'recrutement-cv/zz-cand-a.pdf'),
  ('sportvision-media-prive', 'recrutement-cv/zz-cand-b.pdf');

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts values (p_c, p_a, p_o); $$;
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql into v;
  exception when others then v := 'erreur'; end;
  perform pg_temp.hors();
  return coalesce(v, 'nul');
end $$;
create or replace function pg_temp.essai(p_qui text, p_uid uuid, p_sql text, p_attendu text) returns void language plpgsql as $$
declare v_ok text;
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql; v_ok := 'autorisé';
  exception when others then v_ok := 'refusé'; end;
  perform pg_temp.hors();
  perform pg_temp.note(p_qui, p_attendu, v_ok);
end $$;

-- ── Qui voit quelles candidatures ──
do $$
declare r record;
begin
  for r in select * from (values
      ('admin',                       'c3c3c3c3-0000-0000-0000-000000000001'::uuid, 'A,B,C,D,E'),
      ('production Football',         'c3c3c3c3-0000-0000-0000-000000000002'::uuid, 'A,E'),
      ('production Basket',           'c3c3c3c3-0000-0000-0000-000000000003'::uuid, 'C'),
      ('responsable du pôle Basket',  'c3c3c3c3-0000-0000-0000-000000000009'::uuid, 'C'),
      ('secrétariat',                 'c3c3c3c3-0000-0000-0000-000000000006'::uuid, 'E'),
      ('photographe',                 'c3c3c3c3-0000-0000-0000-000000000004'::uuid, '—'),
      ('CM',                          'c3c3c3c3-0000-0000-0000-000000000005'::uuid, '—'),
      ('comptabilité',                'c3c3c3c3-0000-0000-0000-000000000007'::uuid, '—'),
      ('commercial',                  'c3c3c3c3-0000-0000-0000-000000000008'::uuid, '—')) t(qui, uid, attendu) loop
    perform pg_temp.note('candidatures visibles — ' || r.qui, r.attendu,
      pg_temp.lu(r.uid, 'select coalesce(string_agg(upper(right(email, 15)::text), '','' order by email), ''—'') from (select replace(split_part(email, ''@'', 1), ''zz-cand-'', '''') as email from recruitment_applications where email like ''zz-cand-%'') x'));
  end loop;
end $$;

-- ── Les CV stockés ──
select pg_temp.note('CV lisibles — photographe', '0',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000004', 'select count(*)::text from storage.objects where name like ''recrutement-cv/zz-cand-%'''));
select pg_temp.note('CV lisibles — CM', '0',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000005', 'select count(*)::text from storage.objects where name like ''recrutement-cv/zz-cand-%'''));
select pg_temp.note('CV lisibles — production Football (le terrain, pas le CM)', '1',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000002', 'select count(*)::text from storage.objects where name like ''recrutement-cv/zz-cand-%'''));
select pg_temp.note('CV lisibles — admin', '2',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000001', 'select count(*)::text from storage.objects where name like ''recrutement-cv/zz-cand-%'''));

-- ── Le journal d'activité ──
select pg_temp.note('journal : nom des candidats — commercial', '0',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000008', 'select count(*)::text from activity_log where entity_type = ''recruitment_application'' and entity_id::text like ''d4d4d4d4%'''));
select pg_temp.note('journal : nom des candidats — comptabilité', '0',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000007', 'select count(*)::text from activity_log where entity_type = ''recruitment_application'' and entity_id::text like ''d4d4d4d4%'''));
select pg_temp.note('journal : nom des candidats — production Football', '2',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000002', 'select count(*)::text from activity_log where entity_type = ''recruitment_application'' and entity_id::text like ''d4d4d4d4%'''));
select pg_temp.note('journal : nom des candidats — admin', '5',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000001', 'select count(*)::text from activity_log where entity_type = ''recruitment_application'' and entity_id::text like ''d4d4d4d4%'''));

-- ── La vue des documents du secrétariat ──
select pg_temp.note('documents « recrutement » — photographe', '0',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000004', 'select count(*)::text from secretariat_documents where categorie = ''recrutement_onboarding'' and id::text like ''d4d4d4d4%'''));
select pg_temp.note('documents « recrutement » — secrétariat : le retenu', '1',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000006', 'select count(*)::text from secretariat_documents where categorie = ''recrutement_onboarding'' and id::text like ''d4d4d4d4%'''));

-- ── Traiter une candidature ──
select pg_temp.essai('passer A en entretien — production Football', 'c3c3c3c3-0000-0000-0000-000000000002',
  'update recruitment_applications set statut = ''entretien'' where email = ''zz-cand-a@example.invalid''', 'autorisé');
select pg_temp.note('A est en entretien', 'entretien', (select statut from recruitment_applications where email = 'zz-cand-a@example.invalid'));
do $$ begin
  perform pg_temp.en('c3c3c3c3-0000-0000-0000-000000000002');
  update recruitment_applications set statut = 'refuse' where email = 'zz-cand-b@example.invalid';
  perform pg_temp.en('c3c3c3c3-0000-0000-0000-000000000004');
  update recruitment_applications set statut = 'refuse' where email = 'zz-cand-a@example.invalid';
  perform pg_temp.hors();
end $$;
select pg_temp.note('refuser la candidature CM — production : sans effet', 'nouveau', (select statut from recruitment_applications where email = 'zz-cand-b@example.invalid'));
select pg_temp.note('refuser A — photographe : sans effet', 'entretien', (select statut from recruitment_applications where email = 'zz-cand-a@example.invalid'));
select pg_temp.essai('changer l''e-mail de A — production Football', 'c3c3c3c3-0000-0000-0000-000000000002',
  'update recruitment_applications set email = ''autre@example.invalid'' where email = ''zz-cand-a@example.invalid''', 'refusé');
select pg_temp.essai('relier E à un compte — production Football', 'c3c3c3c3-0000-0000-0000-000000000002',
  'update recruitment_applications set collaborateur_id = ''c3c3c3c3-0000-0000-0000-000000000004'' where email = ''zz-cand-e@example.invalid''', 'refusé');
select pg_temp.essai('relier E à un compte — secrétariat', 'c3c3c3c3-0000-0000-0000-000000000006',
  'update recruitment_applications set collaborateur_id = ''c3c3c3c3-0000-0000-0000-000000000004'' where email = ''zz-cand-e@example.invalid''', 'autorisé');
select pg_temp.note('E est relié au compte', 'oui',
  (select case when collaborateur_id = 'c3c3c3c3-0000-0000-0000-000000000004' then 'oui' else 'non' end from recruitment_applications where email = 'zz-cand-e@example.invalid'));
select pg_temp.essai('retenir A — production Football', 'c3c3c3c3-0000-0000-0000-000000000002',
  'update recruitment_applications set statut = ''retenu'' where email = ''zz-cand-a@example.invalid''', 'autorisé');
select pg_temp.note('une fois A retenu, le secrétariat le voit', 'A,E',
  pg_temp.lu('c3c3c3c3-0000-0000-0000-000000000006', 'select coalesce(string_agg(upper(replace(split_part(email, ''@'', 1), ''zz-cand-'', '''')), '','' order by email), ''—'') from recruitment_applications where email like ''zz-cand-%'''));

-- ── Proposer à la Direction ──
select pg_temp.essai('proposer la candidature sans pôle — photographe', 'c3c3c3c3-0000-0000-0000-000000000004',
  'select propose_candidature_direction(''d4d4d4d4-0000-0000-0000-00000000000d'')', 'refusé');
select pg_temp.essai('proposer A — production Football', 'c3c3c3c3-0000-0000-0000-000000000002',
  'select propose_candidature_direction(''d4d4d4d4-0000-0000-0000-00000000000a'')', 'autorisé');

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
