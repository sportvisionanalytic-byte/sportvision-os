-- ============================================================
-- SPORTVISION CLUB+ — Migration v10
-- Suite de migration-clubplus-v1 à v9.sql. Idempotente.
--
-- Portée : upload réel du logo et de l'écusson du club (Paramètres →
-- Identité du club). Bucket de stockage dédié, même principe que
-- 'portail-media' (migration-portail-v14.sql) : lecture publique (les
-- logos doivent s'afficher sans session), écriture réservée aux membres
-- du club concerné (chemin d'objet préfixé par le club_id).
-- ============================================================

alter table clubs add column if not exists logo_url text;
alter table clubs add column if not exists ecusson_url text;

insert into storage.buckets (id, name, public)
values ('clubplus-media', 'clubplus-media', true)
on conflict (id) do nothing;

drop policy if exists "clubplus_media_public_read" on storage.objects;
create policy "clubplus_media_public_read" on storage.objects for select
  using (bucket_id = 'clubplus-media');

-- Convention de chemin : <club_id>/logo.<ext> ou <club_id>/ecusson.<ext> —
-- storage.foldername(name) découpe le chemin en segments, le premier
-- segment est le club_id, vérifié via is_club_member/is_club_admin
-- (migration-clubplus-v1/v2.sql) plutôt qu'une policy ouverte.

drop policy if exists "clubplus_media_member_insert" on storage.objects;
create policy "clubplus_media_member_insert" on storage.objects for insert
  with check (
    bucket_id = 'clubplus-media'
    and is_club_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "clubplus_media_member_update" on storage.objects;
create policy "clubplus_media_member_update" on storage.objects for update
  using (
    bucket_id = 'clubplus-media'
    and is_club_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "clubplus_media_admin_delete" on storage.objects;
create policy "clubplus_media_admin_delete" on storage.objects for delete
  using (
    bucket_id = 'clubplus-media'
    and is_club_admin(((storage.foldername(name))[1])::uuid)
  );
