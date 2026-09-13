-- Un Pass Photo payé ouvre réellement les photos (13/09/2026).
--
-- Le Pass se vendait sans jamais livrer. `gallery-download` ne connaissait que deux preuves
-- d'achat : un jeton de téléchargement, ou une ligne de commande photo par photo. Un abonnement
-- de saison n'en produit aucune des deux — il pose un `media_entitlements`. La famille payait, et
-- chaque photo lui répondait « cette photo ne fait pas partie de vos achats ».
--
-- La fonction s'appuie désormais sur `can_access_media`, la règle qui garde déjà la lecture du
-- bucket privé. Ce test vérifie cette règle sur le cas exact du Pass Saison : payé, la famille
-- accède ; sans Pass, non ; avec un Pass d'une AUTRE saison, non plus.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee66dd00-0000-0000-0000-000000000001','zz-famille-pass@example.invalid','',now(),'authenticated','authenticated'),
  ('ee66dd00-0000-0000-0000-000000000002','zz-famille-sans@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Pass Photo (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Pass Photo (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 pass' from clu returning id, club_id),
       sais as (select id from saisons where active limit 1),
       autre as (select id from saisons where not active order by label limit 1),
       -- Le club vend au Pass Saison.
       pol as (insert into media_club_policy (club_id, saison_id, default_policy, status)
               select (select club_id from eq), (select id from sais), 'pass_saison', 'active' returning id),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
                  select club_id, 'Lina', 'ZZPass', date '2013-03-03', 'actif', 'ee66dd00-0000-0000-0000-000000000001' from eq returning id, club_id),
       tm as (insert into team_memberships (team_id, club_id, player_id, saison)
              select (select id from eq), (select club_id from eq), (select id from enfant), '2026-2027' returning team_id),
       alb as (insert into media_albums (club_id, team_id, saison_id, title, event_date, status, published_at)
               select (select club_id from eq), (select id from eq), (select id from sais),
                      'ZZ Galerie payante', current_date, 'published', now() returning id),
       pass as (insert into media_entitlements (club_id, saison_id, scope_type, scope_id, status,
                                                purchased_by_user_id, beneficiary_person_id)
                select (select club_id from eq), (select id from sais), 'club', (select club_id from eq), 'active',
                       'ee66dd00-0000-0000-0000-000000000001', (select id from enfant) returning id)
  select (select id from alb) album, (select id from autre) saison_autre;
grant select on ctx to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

select pg_temp.sous('ee66dd00-0000-0000-0000-000000000001');
select pg_temp.note('la famille qui a paye son Pass accede aux photos', 'oui',
  case when can_access_media((select album from ctx)) then 'oui' else 'NON' end);
select pg_temp.stop();

select pg_temp.sous('ee66dd00-0000-0000-0000-000000000002');
select pg_temp.note('une famille sans Pass n''y accede pas', 'non',
  case when can_access_media((select album from ctx)) then 'OUI' else 'non' end);
select pg_temp.stop();

-- Un Pass d'une autre saison ne vaut pas pour celle-ci.
update media_entitlements set saison_id = (select saison_autre from ctx)
 where purchased_by_user_id = 'ee66dd00-0000-0000-0000-000000000001';
select pg_temp.sous('ee66dd00-0000-0000-0000-000000000001');
select pg_temp.note('un Pass d''une autre saison ne donne rien', 'non',
  case when can_access_media((select album from ctx)) then 'OUI' else 'non' end);
select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
