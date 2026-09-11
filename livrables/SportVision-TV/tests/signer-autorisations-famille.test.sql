-- Signer et retirer une autorisation parentale depuis Connect (v176, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • le parent confirmé voit les douze autorisations et peut signer le droit à l'image ;
--   • une fois signé, un média où l'enfant est identifié cesse d'être masqué ;
--   • le retrait le remasque ;
--   • un tiers ne signe rien, un joueur mineur non plus.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e7e7e7e7-0000-0000-0000-000000000001','zz-aut-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('e7e7e7e7-0000-0000-0000-000000000002','zz-aut-tiers@example.invalid','',now(),'authenticated','authenticated'),
  ('e7e7e7e7-0000-0000-0000-000000000003','zz-aut-mineur@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('e7e7e7e7-0000-0000-0000-000000000001','e7e7e7e7-0000-0000-0000-000000000001','QA','Parent autorisations'),
  ('e7e7e7e7-0000-0000-0000-000000000002','e7e7e7e7-0000-0000-0000-000000000002','QA','Tiers') on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Autorisations (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Autorisations (test)', id, 'performance' from cli returning id),
       j as (insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
             select id, 'e7e7e7e7-0000-0000-0000-000000000003', 'QA', 'Enfant autorisations', date '2014-01-01', 'actif' from clu returning id, club_id),
       m as (insert into club_media (club_id, title, type) select club_id, 'ZZ Media avec l''enfant', 'photo' from j returning id)
  select (select id from j) player_id, (select club_id from j) club_id, (select id from m) media;
grant select on ctx to authenticated;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'e7e7e7e7-0000-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
select 'club_media', media, player_id, 'humain', 'valide' from ctx;

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

select pg_temp.note('le parent voit les douze autorisations', '12',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000001',
    'select count(*)::text from mes_autorisations((select player_id from ctx))'));
select pg_temp.note('aucune n''est signée au départ', 'non_transmise',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000001',
    'select statut from mes_autorisations((select player_id from ctx)) where code = ''droit_image'''));
select pg_temp.note('le média où l''enfant est identifié est masqué', 'masqué',
  case when media_has_unauthorized_tagged_player('club_media', (select media from ctx)) then 'masqué' else 'VISIBLE' end);

select pg_temp.note('un tiers ne signe pas', 'refusé',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000002',
    'select signer_autorisation((select player_id from ctx), ''droit_image'', true)::text'));
select pg_temp.note('l''enfant mineur ne signe pas pour lui-même', 'refusé',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000003',
    'select signer_autorisation((select player_id from ctx), ''droit_image'', true)::text'));

select pg_temp.note('le parent signe le droit à l''image', 'valide',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000001',
    'select signer_autorisation((select player_id from ctx), ''droit_image'', true)->>''statut'''));
select pg_temp.note('l''écran le dit signé', 'valide',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000001',
    'select statut from mes_autorisations((select player_id from ctx)) where code = ''droit_image'''));
select pg_temp.note('le média n''est plus masqué', 'visible',
  case when media_has_unauthorized_tagged_player('club_media', (select media from ctx)) then 'MASQUÉ' else 'visible' end);

select pg_temp.note('le parent retire son autorisation', '1',
  pg_temp.essai('e7e7e7e7-0000-0000-0000-000000000001',
    'select retirer_autorisation((select player_id from ctx), ''droit_image'', ''je change d''''avis'')->>''retirees'''));
select pg_temp.note('le média redevient masqué', 'masqué',
  case when media_has_unauthorized_tagged_player('club_media', (select media from ctx)) then 'masqué' else 'VISIBLE' end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
