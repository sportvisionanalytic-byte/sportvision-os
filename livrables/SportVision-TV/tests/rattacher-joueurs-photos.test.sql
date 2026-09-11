-- Rattacher un joueur à une photo de galerie (v162, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la Production rattache et détache un joueur de l'équipe de la galerie ;
--   • un joueur étranger à l'équipe est refusé ;
--   • un photographe qui n'était pas sur la mission ne marque rien ;
--   • un coach du club ne marque rien non plus ;
--   • détacher une suggestion de machine la marque « rejetée » et ne l'efface pas ;
--   • un rattachement validé rend la photo visible au parent (v160) ; l'enlever la referme.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('d1d1d1d1-1111-0000-0000-000000000001','zz-rj-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('d1d1d1d1-1111-0000-0000-000000000002','zz-rj-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('d1d1d1d1-1111-0000-0000-000000000003','zz-rj-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('d1d1d1d1-1111-0000-0000-000000000004','zz-rj-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, email, prenom, nom, role, actif) values
  ('d1d1d1d1-1111-0000-0000-000000000001','zz-rj-prod@example.invalid','QA','Production','prod',true),
  ('d1d1d1d1-1111-0000-0000-000000000002','zz-rj-photo@example.invalid','QA','Photographe','photo',true)
on conflict (id) do update set role = excluded.role, actif = true;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Rattachement (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Rattachement (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13' from clu returning id, club_id),
       sa as (select id from saisons order by date_debut desc limit 1),
       j1 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select club_id, 'QA', 'Dans l''équipe', date '2013-02-02', 'actif' from eq returning id, club_id),
       j2 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select club_id, 'QA', 'Hors équipe', date '2013-05-05', 'actif' from eq returning id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select eq.id, j1.id, eq.club_id, (select id from sa), '2026-2027', 'active' from eq, j1 returning player_id),
       al as (insert into media_albums (title, club_id, team_id, status, event_date)
              select 'ZZ Galerie U13', club_id, id, 'published', current_date from eq returning id, club_id),
       ph as (insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position)
              select id, club_id, 'photo', 'sportvision-media-prive', 'zz/rj1.jpg', 'zz/rj1-p.webp', 'zz/rj1-t.webp', 'ready', 1 from al returning id)
  select (select id from eq) team_id, (select id from j1) joueur, (select id from j2) etranger,
         (select id from al) album, (select id from ph) photo, (select club_id from eq) club_id;
grant select on ctx to authenticated;
insert into club_members (user_id, club_id, role, status, teams)
select 'd1d1d1d1-1111-0000-0000-000000000003'::uuid, club_id, 'coach', 'actif', '["ZZ U13"]'::jsonb from ctx;
insert into parent_profiles (id, user_id, prenom, nom)
values ('d1d1d1d1-1111-0000-0000-000000000004','d1d1d1d1-1111-0000-0000-000000000004','QA','Parent') on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'd1d1d1d1-1111-0000-0000-000000000004'::uuid, joueur, 'parent', 'confirme', now() from ctx;

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

select pg_temp.note('la Production voit les joueurs de l''équipe de la galerie', 'Dans l''équipe',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select string_agg(nom, '', '') from media_joueurs_de_galerie((select album from ctx))'));
select pg_temp.note('le photographe hors mission ne voit rien', '∅',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000002',
    'select coalesce(string_agg(nom, '', ''), ''∅'') from media_joueurs_de_galerie((select album from ctx))'));
select pg_temp.note('le coach du club ne voit pas cet écran', 'refusé',
  case when pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000003',
    'select coalesce(string_agg(nom, '', ''), ''∅'') from media_joueurs_de_galerie((select album from ctx))') in ('∅','refusé')
  then 'refusé' else 'vu' end);

select pg_temp.note('rattacher un joueur étranger à l''équipe est refusé', 'refusé',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select media_rattacher_joueur((select photo from ctx), (select etranger from ctx), true)::text'));
select pg_temp.note('la Production rattache le joueur à la photo', 'valide',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select media_rattacher_joueur((select photo from ctx), (select joueur from ctx), true)->>''statut'''));
select pg_temp.note('le compteur du joueur passe à 1', '1',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select nb_photos::text from media_joueurs_de_galerie((select album from ctx)) where player_id = (select joueur from ctx)'));
select pg_temp.note('le parent voit alors la photo de son enfant', 'zz/rj1-p.webp',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000004',
    'select preview_path from media_photos_du_joueur((select album from ctx), (select joueur from ctx))'));
select pg_temp.note('un photographe hors mission ne peut pas rattacher', 'refusé',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000002',
    'select media_rattacher_joueur((select photo from ctx), (select joueur from ctx), true)::text'));
select pg_temp.note('détacher supprime le rattachement posé à la main', 'supprime',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select media_rattacher_joueur((select photo from ctx), (select joueur from ctx), false)->>''statut'''));
select pg_temp.note('le parent ne voit plus rien', '∅',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000004',
    'select coalesce(string_agg(preview_path, '', ''), ''∅'') from media_photos_du_joueur((select album from ctx), (select joueur from ctx))'));

-- Une suggestion de machine : elle attend, elle ne montre rien, et son refus laisse une trace.
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, score, moteur)
select 'media_asset', photo, joueur, 'suggestion', 'propose', 0.71, 'a_choisir' from ctx;
select pg_temp.note('la suggestion apparaît dans la file à trancher', '1',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select count(*)::text from media_suggestions_a_trancher(50) where asset_id = (select photo from ctx)'));
select pg_temp.note('tant qu''elle n''est pas validée, le parent ne voit rien', '∅',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000004',
    'select coalesce(string_agg(preview_path, '', ''), ''∅'') from media_photos_du_joueur((select album from ctx), (select joueur from ctx))'));
select pg_temp.note('refuser une suggestion la marque rejetée, sans l''effacer', 'rejete',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select media_rattacher_joueur((select photo from ctx), (select joueur from ctx), false)->>''statut'''));
select pg_temp.note('elle ne revient plus dans la file', '0',
  pg_temp.essai('d1d1d1d1-1111-0000-0000-000000000001',
    'select count(*)::text from media_suggestions_a_trancher(50) where asset_id = (select photo from ctx)'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
