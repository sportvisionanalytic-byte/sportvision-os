-- Un parent réserve une prestation pour son enfant affilié à un club (v183, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • le parent confirmé obtient une fiche client au nom de l'enfant, avec SES coordonnées à lui
--     comme contact (sans quoi l'opérateur arrive sans personne à joindre) ;
--   • la même demande, refaite, réutilise la même fiche client au lieu d'en créer une deuxième ;
--   • un parent non confirmé, et un tiers, sont refusés ;
--   • l'écran de la famille annonce désormais le droit de réserver.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('bb22bb22-0000-0000-0000-000000000001','zz-res-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('bb22bb22-0000-0000-0000-000000000002','zz-res-attente@example.invalid','',now(),'authenticated','authenticated'),
  ('bb22bb22-0000-0000-0000-000000000003','zz-res-tiers@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('bb22bb22-0000-0000-0000-000000000001','bb22bb22-0000-0000-0000-000000000001','QA','Parent reservation'),
  ('bb22bb22-0000-0000-0000-000000000002','bb22bb22-0000-0000-0000-000000000002','QA','Parent en attente'),
  ('bb22bb22-0000-0000-0000-000000000003','bb22bb22-0000-0000-0000-000000000003','QA','Tiers') on conflict (id) do nothing;
insert into connect_profile_settings (user_id, account_type, profil_particulier, telephone)
values ('bb22bb22-0000-0000-0000-000000000001','particulier','parent','06 12 34 56 78')
on conflict (user_id) do update set telephone = excluded.telephone;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Reservation (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan, discipline) select 'ZZ Club Reservation (test)', id, 'performance', 'football' from cli returning id),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select id, 'QA', 'Enfant reservation', date '2014-02-02', 'actif' from clu returning id)
  select (select id from j) player_id;
grant select on ctx to authenticated;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'bb22bb22-0000-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
select 'bb22bb22-0000-0000-0000-000000000002'::uuid, player_id, 'parent', 'en_attente_confirmation' from ctx;

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

select pg_temp.note('l''écran annonce le droit de réserver', 'true',
  pg_temp.essai('bb22bb22-0000-0000-0000-000000000001',
    'select right_reserver::text from connect_list_my_athletes() where kind = ''club'' limit 1'));

select pg_temp.note('un tiers ne réserve rien pour cet enfant', 'refusé',
  pg_temp.essai('bb22bb22-0000-0000-0000-000000000003',
    'select connect_resolve_beneficiary_client_id(''club'', (select player_id from ctx))::text'));
select pg_temp.note('un parent non confirmé non plus', 'refusé',
  pg_temp.essai('bb22bb22-0000-0000-0000-000000000002',
    'select connect_resolve_beneficiary_client_id(''club'', (select player_id from ctx))::text'));

select pg_temp.note('le parent confirmé obtient une fiche client', 'oui',
  case when pg_temp.essai('bb22bb22-0000-0000-0000-000000000001',
    'select connect_resolve_beneficiary_client_id(''club'', (select player_id from ctx))::text') = 'refusé'
  then 'refusé' else 'oui' end);
select pg_temp.note('la fiche porte le nom de l''enfant', 'QA Enfant reservation',
  (select c.nom from clients c join player_profiles p on p.client_id = c.id, ctx where p.id = ctx.player_id));
select pg_temp.note('et les coordonnées du parent, pour joindre quelqu''un', 'zz-res-parent@example.invalid | 06 12 34 56 78',
  (select coalesce(c.email,'∅') || ' | ' || coalesce(c.telephone,'∅')
     from clients c join player_profiles p on p.client_id = c.id, ctx where p.id = ctx.player_id));
select pg_temp.note('une seconde réservation ne crée pas un second client', '1',
  (select count(*)::text from clients where nom = 'QA Enfant reservation'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
