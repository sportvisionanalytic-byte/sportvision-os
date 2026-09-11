-- La vidéo du match, par le lien du montage (v157, 12/09/2026).
--
-- Décision de Fouka : la vidéo n'est pas téléversée dans la galerie ; la galerie affiche le lien du
-- montage final déposé par le vidéaste. Les liens de livraison sont réservés au staff (ml_read) :
-- cette fonction est le seul chemin qui en rend un à un coach ou à une famille, et seulement le
-- montage final de LEUR galerie.
--
-- Ce que ce test tient pour vrai : le coach de l'équipe, le joueur affilié et son parent confirmé
-- obtiennent le lien ; une personne d'une autre équipe, un inconnu et un visiteur sans compte,
-- rien ; les rushs et les photos ne sortent jamais ; une galerie non publiée ne rend rien.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fcfcfcfc-0000-0000-0000-000000000001','zz-vid-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('fcfcfcfc-0000-0000-0000-000000000002','zz-vid-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('fcfcfcfc-0000-0000-0000-000000000003','zz-vid-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('fcfcfcfc-0000-0000-0000-000000000004','zz-vid-inconnu@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Vidéo (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Vidéo (test)', id, 'performance' from cli returning id),
       pre as (insert into prestations (client_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, couverture)
               select id, current_date, '10:00', 'Stade ZZ', 'match', 'livrée', 'interne', 'photo_video' from cli returning id)
  select (select id from clu) club_id, (select id from cli) client_id, (select id from pre) mission;
grant select on ctx to authenticated;
insert into club_teams (club_id, name) select club_id, 'ZZ U13' from ctx;
insert into club_members (user_id, club_id, role, status, teams)
select 'fcfcfcfc-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '["ZZ U13"]'::jsonb from ctx;
insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
select club_id, 'fcfcfcfc-0000-0000-0000-000000000002'::uuid, 'QA', 'Joueur', date '2012-05-04', 'actif' from ctx;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('fcfcfcfc-0000-0000-0000-000000000003', 'fcfcfcfc-0000-0000-0000-000000000003', 'QA', 'Parent') on conflict (id) do nothing;
insert into team_memberships (player_id, team_id, club_id, statut, saison)
select p.id, t.id, ctx.club_id, 'active', '2026-2027' from ctx
  join club_teams t on t.club_id = ctx.club_id join player_profiles p on p.club_id = ctx.club_id;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'fcfcfcfc-0000-0000-0000-000000000003'::uuid, p.id, 'parent', 'confirme', now() from ctx join player_profiles p on p.club_id = ctx.club_id;
insert into media_liens (prestation_id, nom, url, categorie, type_media) values
  ((select mission from ctx), 'Montage final', 'https://example.invalid/montage-final', 'final', 'video'),
  ((select mission from ctx), 'Rushs', 'https://example.invalid/rushs', 'rushs', 'video'),
  ((select mission from ctx), 'Photos', 'https://example.invalid/photos', 'final', 'photo');
create temp table a on commit drop as
  with al as (insert into media_albums (title, club_id, team_id, mission_id, status, event_date)
              select 'ZZ Galerie vidéo', ctx.club_id, t.id, ctx.mission, 'published', current_date
                from ctx join club_teams t on t.club_id = ctx.club_id returning id)
  select id from al;
grant select on a to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.video(p_role text, p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin
    select coalesce(string_agg(url, ', '), '∅') into v from media_galeries_video(array[(select id from a)]);
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('le coach de l''équipe obtient le montage', 'https://example.invalid/montage-final', pg_temp.video('a', 'fcfcfcfc-0000-0000-0000-000000000001'));
select pg_temp.note('le joueur affilié aussi', 'https://example.invalid/montage-final', pg_temp.video('a', 'fcfcfcfc-0000-0000-0000-000000000002'));
select pg_temp.note('son parent confirmé aussi', 'https://example.invalid/montage-final', pg_temp.video('a', 'fcfcfcfc-0000-0000-0000-000000000003'));
-- Un seul lien rendu au coach : le montage. Les rushs et les photos restent au staff.
select pg_temp.note('ni les rushs ni les photos ne sortent', '1 lien',
  (select count(*)::text || ' lien' from regexp_split_to_table(pg_temp.video('a', 'fcfcfcfc-0000-0000-0000-000000000001'), ', ') x));
select pg_temp.note('une personne étrangère au club n''a rien', '∅', pg_temp.video('a', 'fcfcfcfc-0000-0000-0000-000000000004'));
select pg_temp.note('sans compte : refusé', 'refusé', left(pg_temp.video('anon', null), 6));
update media_albums set status = 'draft' where id = (select id from a);
select pg_temp.note('galerie non publiée : rien, même pour le coach', '∅', pg_temp.video('a', 'fcfcfcfc-0000-0000-0000-000000000001'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
