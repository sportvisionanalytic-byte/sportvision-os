-- Le filigrane d'un aperçu se sait, photo par photo (v181, 12/09/2026).
--
-- Ce que ce test tient pour vrai : la colonne existe, elle accepte les trois états (protégé, en
-- clair, inconnu), et une galerie payante peut donc être contrôlée avant sa mise en ligne.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Filigrane (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Filigrane (test)', id, 'performance' from cli returning id),
       al as (insert into media_albums (title, club_id, status, event_date, watermark_previews)
              select 'ZZ Galerie filigrane', id, 'draft', current_date, true from clu returning id, club_id)
  select (select id from al) album;

insert into media_assets (album_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
select album, 'photo', 'sportvision-media-prive', 'zz/f1.jpg', 'zz/f1-p.webp', 'zz/f1-t.webp', 'ready', 1, true from ctx union all
select album, 'photo', 'sportvision-media-prive', 'zz/f2.jpg', 'zz/f2-p.webp', 'zz/f2-t.webp', 'ready', 2, false from ctx union all
select album, 'photo', 'sportvision-media-prive', 'zz/f3.jpg', 'zz/f3-p.webp', 'zz/f3-t.webp', 'ready', 3, null from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select pg_temp.note('une photo protégée est reconnue comme telle', '1',
  (select count(*)::text from media_assets a, ctx where a.album_id = ctx.album and a.preview_watermarked));
select pg_temp.note('les aperçus restés en clair se comptent', '1',
  (select count(*)::text from media_assets a, ctx where a.album_id = ctx.album and a.preview_watermarked is false));
select pg_temp.note('les photos d''avant gardent un état inconnu', '1',
  (select count(*)::text from media_assets a, ctx where a.album_id = ctx.album and a.preview_watermarked is null));
select pg_temp.note('le contrôle avant mise en ligne trouve 2 photos à régénérer', '2',
  (select count(*)::text from media_assets a, ctx
    where a.album_id = ctx.album and a.status = 'ready' and coalesce(a.preview_watermarked, false) = false));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
