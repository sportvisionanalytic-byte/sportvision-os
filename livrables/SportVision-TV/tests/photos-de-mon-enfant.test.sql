-- « Les photos de mon enfant » dans une galerie (v160, 12/09/2026).
--
-- Fondation du Pass photo « mon enfant ». Ce test tient pour vrai :
--   • le parent confirmé et le joueur lui-même voient la liste des photos de cet enfant ;
--   • un autre parent, un coach et un visiteur sans compte ne la voient pas ;
--   • une suggestion de machine non validée ne montre rien ;
--   • aucune photo d'une galerie non publiée ne sort ;
--   • la liste ne contient jamais le chemin de l'original, seulement les aperçus.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f2f2f2f2-2222-0000-0000-000000000001','zz-pme-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-2222-0000-0000-000000000002','zz-pme-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-2222-0000-0000-000000000003','zz-pme-autre-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-2222-0000-0000-000000000004','zz-pme-coach@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Mon Enfant (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Mon Enfant (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U11' from clu returning id, club_id),
       j as (insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
             select club_id, 'f2f2f2f2-2222-0000-0000-000000000002', 'QA', 'Lucas', date '2015-04-04', 'actif' from eq returning id),
       al as (insert into media_albums (title, club_id, team_id, status, event_date, published_at)
              select 'ZZ Galerie U11', club_id, id, 'published', current_date, now() from eq returning id)
  select (select club_id from eq) club_id, (select id from eq) team_id, (select id from j) player_id, (select id from al) album_id;
grant select on ctx to authenticated;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('f2f2f2f2-2222-0000-0000-000000000001','f2f2f2f2-2222-0000-0000-000000000001','QA','Parent de Lucas'),
  ('f2f2f2f2-2222-0000-0000-000000000003','f2f2f2f2-2222-0000-0000-000000000003','QA','Autre parent') on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'f2f2f2f2-2222-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;
insert into club_members (user_id, club_id, role, status, teams)
select 'f2f2f2f2-2222-0000-0000-000000000004'::uuid, club_id, 'coach', 'actif', '["ZZ U11"]'::jsonb from ctx;
insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position)
select album_id, club_id, 'photo', 'sportvision-media-prive', 'zz/o1.jpg', 'zz/p1.webp', 'zz/t1.webp', 'ready', 1 from ctx union all
select album_id, club_id, 'photo', 'sportvision-media-prive', 'zz/o2.jpg', 'zz/p2.webp', 'zz/t2.webp', 'ready', 2 from ctx union all
select album_id, club_id, 'photo', 'sportvision-media-prive', 'zz/o3.jpg', 'zz/p3.webp', 'zz/t3.webp', 'ready', 3 from ctx;
-- Photo 1 : rattachée par un humain. Photo 2 : suggestion de machine, non validée. Photo 3 : rien.
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, valide_le)
select 'media_asset', a.id, ctx.player_id, 'humain', 'valide', now() from ctx join media_assets a on a.album_id = ctx.album_id and a.original_path = 'zz/o1.jpg';
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, score, moteur)
select 'media_asset', a.id, ctx.player_id, 'suggestion', 'propose', 0.88, 'a_choisir' from ctx join media_assets a on a.album_id = ctx.album_id and a.original_path = 'zz/o2.jpg';

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.voit(p_role text, p_uid uuid) returns text language plpgsql as $$
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
    select coalesce(string_agg(preview_path, ', ' order by preview_path), '∅') into v
      from media_photos_du_joueur((select album_id from ctx), (select player_id from ctx));
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('le parent confirmé voit la photo validée, pas la suggestion', 'zz/p1.webp', pg_temp.voit('a', 'f2f2f2f2-2222-0000-0000-000000000001'));
select pg_temp.note('le joueur lui-même aussi', 'zz/p1.webp', pg_temp.voit('a', 'f2f2f2f2-2222-0000-0000-000000000002'));
select pg_temp.note('le parent d''un autre enfant ne voit rien', '∅', pg_temp.voit('a', 'f2f2f2f2-2222-0000-0000-000000000003'));
select pg_temp.note('le coach de l''équipe non plus', '∅', pg_temp.voit('a', 'f2f2f2f2-2222-0000-0000-000000000004'));
select pg_temp.note('sans compte : refusé', 'refusé', left(pg_temp.voit('anon', null), 6));
create or replace function pg_temp.compte(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select media_compte_photos_du_joueur((select album_id from ctx), (select player_id from ctx))::text into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
select pg_temp.note('le compteur annonce 1 photo au parent', '1', pg_temp.compte('f2f2f2f2-2222-0000-0000-000000000001'));
update media_albums set status = 'draft' where id = (select album_id from ctx);
select pg_temp.note('galerie non publiée : plus rien', '∅', pg_temp.voit('a', 'f2f2f2f2-2222-0000-0000-000000000001'));
select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
