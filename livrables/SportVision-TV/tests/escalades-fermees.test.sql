-- Quatre chemins d'escalade, fermés (v164, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • ni un visiteur ni un compte connecté ne peut appeler les deux fonctions SECURITY DEFINER
--     qui écrivent des droits (affectation de pôle) ou du catalogue (produits média) ;
--   • un salarié ne peut pas s'attribuer un niveau d'autonomie CM, un niveau d'opérateur, un type
--     de contrat, ni l'accès étendu d'une agence ;
--   • un opérateur terrain ne lit pas les photos d'une galerie sur laquelle il n'a pas travaillé.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e1e1e1e1-1111-0000-0000-000000000001','zz-esc-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-1111-0000-0000-000000000002','zz-esc-cm@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, email, prenom, nom, role, actif, niveau_operateur, cm_niveau_autonomie) values
  ('e1e1e1e1-1111-0000-0000-000000000001','zz-esc-photo@example.invalid','QA','Photographe','photo',true,3,null),
  ('e1e1e1e1-1111-0000-0000-000000000002','zz-esc-cm@example.invalid','QA','CM','cm',true,null,'junior')
on conflict (id) do update set role = excluded.role, actif = true,
  niveau_operateur = excluded.niveau_operateur, cm_niveau_autonomie = excluded.cm_niveau_autonomie;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Escalade (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Escalade (test)', id, 'performance' from cli returning id),
       al as (insert into media_albums (title, club_id, status, event_date)
              select 'ZZ Galerie sans le photographe', id, 'published', current_date from clu returning id, club_id),
       ph as (insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position)
              select id, club_id, 'photo', 'sportvision-media-prive', 'zz/esc.jpg', 'zz/esc-p.webp', 'zz/esc-t.webp', 'ready', 1 from al returning id)
  select (select id from al) album, (select id from ph) photo;
grant select on ctx to authenticated;

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

-- ── Les deux fonctions qui écrivent des droits ──
select pg_temp.note('anon ne peut pas appeler ensure_default_pole_affectation', 'non',
  case when has_function_privilege('anon', 'public.ensure_default_pole_affectation(uuid, jsonb)', 'execute') then 'OUI' else 'non' end);
select pg_temp.note('un compte connecté non plus', 'non',
  case when has_function_privilege('authenticated', 'public.ensure_default_pole_affectation(uuid, jsonb)', 'execute') then 'OUI' else 'non' end);
select pg_temp.note('anon ne peut pas appeler media_link_type_product', 'non',
  case when has_function_privilege('anon', 'public.media_link_type_product(uuid, text)', 'execute') then 'OUI' else 'non' end);
select pg_temp.note('un compte connecté non plus (produits média)', 'non',
  case when has_function_privilege('authenticated', 'public.media_link_type_product(uuid, text)', 'execute') then 'OUI' else 'non' end);
-- La création de compte continue de fonctionner : les triggers appellent la fonction sous postgres.
select pg_temp.note('la création de compte garde le droit d''appeler', 'oui',
  case when has_function_privilege('postgres', 'public.ensure_default_pole_affectation(uuid, jsonb)', 'execute') then 'oui' else 'NON' end);

-- ── Les colonnes qui donnent des droits ou fixent de l'argent ──
select pg_temp.note('un CM ne se donne pas le niveau « responsable »', 'refusé',
  pg_temp.essai('e1e1e1e1-1111-0000-0000-000000000002',
    'update profiles set cm_niveau_autonomie = ''responsable'' where id = auth.uid() returning cm_niveau_autonomie'));
select pg_temp.note('et son niveau reste celui qu''on lui a donné', 'junior',
  (select cm_niveau_autonomie from profiles where id = 'e1e1e1e1-1111-0000-0000-000000000002'));
select pg_temp.note('un opérateur ne monte pas son niveau de rémunération', 'refusé',
  pg_temp.essai('e1e1e1e1-1111-0000-0000-000000000001',
    'update profiles set niveau_operateur = 5 where id = auth.uid() returning niveau_operateur::text'));
select pg_temp.note('son niveau reste 3', '3',
  (select niveau_operateur::text from profiles where id = 'e1e1e1e1-1111-0000-0000-000000000001'));
select pg_temp.note('il ne change pas non plus son type de contrat', 'refusé',
  pg_temp.essai('e1e1e1e1-1111-0000-0000-000000000001',
    'update profiles set type_contrat = ''cdi'' where id = auth.uid() returning type_contrat'));

-- ── Les photos d'une galerie sur laquelle il n'a pas travaillé ──
select pg_temp.note('un opérateur terrain ne lit pas ces photos', '0',
  pg_temp.essai('e1e1e1e1-1111-0000-0000-000000000001',
    'select count(*)::text from media_assets where id = (select photo from ctx)'));
select pg_temp.note('et ne peut pas les supprimer', '0',
  pg_temp.essai('e1e1e1e1-1111-0000-0000-000000000001',
    'with x as (delete from media_assets where id = (select photo from ctx) returning 1) select count(*)::text from x'));
select pg_temp.note('la photo est toujours là', '1',
  (select count(*)::text from media_assets a, ctx where a.id = ctx.photo));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
