-- ============================================================
-- SPORTVISION CLUB+ — Migration v47
-- Suite de migration-clubplus-v46-organisation-editable.sql. Idempotente.
--
-- Portée (19/08/2026, audit pré-lancement, suite directe de v46) : premier
-- bucket Supabase Storage de tout le projet (aucun pattern d'upload
-- n'existait encore dans app-next — voir le commentaire de
-- MatchResultModal.tsx "aucune référence à supabase.storage dans le repo").
-- Sert à stocker le logo de chaque club (clubs.logo_url, colonne déjà
-- existante depuis migration-clubplus-v10.sql, jamais utilisée jusqu'ici).
--
-- Convention de chemin : {club_id}/logo.{ext} — un seul logo par club,
-- toujours au même chemin (écrasé à chaque nouvel upload plutôt
-- qu'accumulé), ce qui évite d'avoir à nettoyer les anciens fichiers.
--
-- Lecture publique (bucket public) : le logo est affiché dans le Studio,
-- les documents et les e-mails (voir texte déjà présent dans
-- settings/organization/page.tsx), y compris à des destinataires qui
-- n'ont pas de session Supabase (client final recevant un e-mail) — une
-- URL signée expirante serait inadaptée à cet usage. Écriture réservée à
-- l'admin du CLUB PROPRIÉTAIRE du dossier (premier segment du chemin =
-- club_id), vérifié via is_club_admin() — même fonction déjà utilisée par
-- clubs_admin_update (migration-clubplus-v2.sql).
--
-- EXÉCUTÉE le 19/08/2026 (audit pré-lancement, agent autonome).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "club_logos_public_read" on storage.objects;
create policy "club_logos_public_read" on storage.objects for select
  using (bucket_id = 'club-logos');

drop policy if exists "club_logos_admin_write" on storage.objects;
create policy "club_logos_admin_write" on storage.objects for insert
  with check (
    bucket_id = 'club-logos'
    and is_club_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "club_logos_admin_update" on storage.objects;
create policy "club_logos_admin_update" on storage.objects for update
  using (
    bucket_id = 'club-logos'
    and is_club_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "club_logos_admin_delete" on storage.objects;
create policy "club_logos_admin_delete" on storage.objects for delete
  using (
    bucket_id = 'club-logos'
    and is_club_admin(((storage.foldername(name))[1])::uuid)
  );

-- ────────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à exécuter manuellement, lecture seule)
-- ────────────────────────────────────────────────────────────────────────
-- select id, public, file_size_limit from storage.buckets where id = 'club-logos';
-- select policyname from pg_policies where tablename = 'objects' and policyname like 'club_logos%';
-- -- attendu : 4 policies.
