-- Publier une galerie prévient l'équipe concernée, et elle seule (v156, 11/09/2026).
--
-- Décision de Fouka : notification dans l'application, jamais d'e-mail. Quand la Production publie
-- la galerie d'une équipe, le coach de cette équipe (Club+) et les familles de cette équipe
-- (Connect : joueur affilié, parent confirmé) la voient arriver.
-- Ce test tient pour vrai : le coach de l'équipe, le joueur et son parent sont prévenus ; le coach
-- d'une autre équipe, un joueur d'une autre équipe et un parent non confirmé ne le sont pas ;
-- chacun est envoyé sur une page qui existe pour lui ; repasser la galerie en brouillon puis la
-- republier ne prévient pas deux fois.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fbfbfbfb-0000-0000-0000-000000000001','zz-gp-coach13@example.invalid','',now(),'authenticated','authenticated'),
  ('fbfbfbfb-0000-0000-0000-000000000002','zz-gp-coach15@example.invalid','',now(),'authenticated','authenticated'),
  ('fbfbfbfb-0000-0000-0000-000000000003','zz-gp-joueur13@example.invalid','',now(),'authenticated','authenticated'),
  ('fbfbfbfb-0000-0000-0000-000000000004','zz-gp-parent13@example.invalid','',now(),'authenticated','authenticated'),
  ('fbfbfbfb-0000-0000-0000-000000000005','zz-gp-joueur15@example.invalid','',now(),'authenticated','authenticated'),
  ('fbfbfbfb-0000-0000-0000-000000000006','zz-gp-parent-non-confirme@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Notif Galerie (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Notif Galerie (test)', id, 'performance' from cli returning id)
  select (select id from clu) club_id;
grant select on ctx to authenticated;
insert into club_teams (club_id, name) select club_id, n from ctx, (values ('ZZ U13'), ('ZZ U15')) v(n);
insert into club_members (user_id, club_id, role, status, teams)
select 'fbfbfbfb-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '["ZZ U13"]'::jsonb from ctx union all
select 'fbfbfbfb-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', '["ZZ U15"]'::jsonb from ctx;
insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
select club_id, 'fbfbfbfb-0000-0000-0000-000000000003'::uuid, 'QA', 'Joueur U13', date '2012-05-04', 'actif' from ctx union all
select club_id, 'fbfbfbfb-0000-0000-0000-000000000005'::uuid, 'QA', 'Joueur U15', date '2010-05-04', 'actif' from ctx;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('fbfbfbfb-0000-0000-0000-000000000004', 'fbfbfbfb-0000-0000-0000-000000000004', 'QA', 'Parent confirmé'),
  ('fbfbfbfb-0000-0000-0000-000000000006', 'fbfbfbfb-0000-0000-0000-000000000006', 'QA', 'Parent en attente')
on conflict (id) do nothing;
insert into team_memberships (player_id, team_id, club_id, statut, saison)
select p.id, t.id, ctx.club_id, 'active', '2026-2027' from ctx
  join club_teams t on t.club_id = ctx.club_id
  join player_profiles p on p.club_id = ctx.club_id and ((t.name = 'ZZ U13' and p.nom = 'Joueur U13') or (t.name = 'ZZ U15' and p.nom = 'Joueur U15'));
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'fbfbfbfb-0000-0000-0000-000000000004'::uuid, p.id, 'parent', 'confirme', now() from ctx join player_profiles p on p.club_id = ctx.club_id and p.nom = 'Joueur U13' union all
select 'fbfbfbfb-0000-0000-0000-000000000006'::uuid, p.id, 'parent', 'en_attente_confirmation', null::timestamptz from ctx join player_profiles p on p.club_id = ctx.club_id and p.nom = 'Joueur U13';
create temp table a on commit drop as
  with al as (insert into media_albums (title, club_id, team_id, status, event_date)
              select 'ZZ Galerie U13 du 17/10', ctx.club_id, t.id, 'draft', current_date
                from ctx join club_teams t on t.club_id = ctx.club_id and t.name = 'ZZ U13' returning id)
  select id from al;
grant select on a to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.prevenus() returns text language sql as $$
  select coalesce(string_agg(split_part(u.email, '@', 1), ', ' order by u.email), '∅')
    from member_notifications n join auth.users u on u.id = n.user_id
   where n.title like '%ZZ Galerie U13%' or n.body like '%ZZ Galerie U13%'; $$;

select pg_temp.note('galerie en brouillon : personne n''est prévenu', '∅', pg_temp.prevenus());
update media_albums set status = 'published', published_at = now() where id = (select id from a);
select pg_temp.note('à la publication : le coach de l''équipe, le joueur et son parent confirmé',
  'zz-gp-coach13, zz-gp-joueur13, zz-gp-parent13', pg_temp.prevenus());
-- Chacun est envoyé sur une page qui existe POUR LUI (v168) : le parent était renvoyé vers
-- « /photos », page de l'Espace joueur, qui le redirigeait chez lui sans lui montrer les photos.
select pg_temp.note('le coach va aux galeries du club', 'oui',
  (select case when count(*) = 1 then 'oui' else 'NON' end from member_notifications n
    where n.user_id = 'fbfbfbfb-0000-0000-0000-000000000001' and n.target_href like '/galeries?galerie=%'));
select pg_temp.note('le joueur va à ses photos', 'oui',
  (select case when count(*) = 1 then 'oui' else 'NON' end from member_notifications n
    where n.user_id = 'fbfbfbfb-0000-0000-0000-000000000003' and n.target_href like '/photos?galerie=%'));
select pg_temp.note('le parent va aux photos de son enfant, pas dans l''espace joueur', 'oui',
  (select case when count(*) = 1 then 'oui' else 'NON' end from member_notifications n
    where n.user_id = 'fbfbfbfb-0000-0000-0000-000000000004'
      and n.target_href like '/particulier/sportifs/club/%/photos?galerie=%'));
update media_albums set status = 'draft' where id = (select id from a);
update media_albums set status = 'published', published_at = now() where id = (select id from a);
select pg_temp.note('republier ne prévient pas deux fois', '3',
  (select count(*)::text from member_notifications where title like '%ZZ Galerie U13%' or body like '%ZZ Galerie U13%'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
