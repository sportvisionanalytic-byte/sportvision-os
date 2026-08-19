-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v55
-- Photo de profil (Espace joueur + Espace particulier).
--
-- Contexte : remonté le 15/08 en testant l'app — aucun moyen d'ajouter une
-- photo de profil, seul le monogramme (initiale) est affiché partout.
--
-- Stockage : réutilise le bucket `portail-media` (déjà public en lecture,
-- migration-portail-v14.sql), même principe que la pièce jointe des messages
-- (migration-connect-v47-portail-media-message-attachments.sql) — policy
-- INSERT/UPDATE additive scopée au dossier avatars/<user_id>/..., jamais un
-- nouveau bucket pour une seule fonctionnalité.
--
-- Idempotente (add column if not exists, drop policy if exists avant chaque
-- create policy).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- colonne connect_profile_settings.avatar_url et policies
-- portail_media_avatar_insert/update (storage.objects) existent déjà en
-- base. Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

alter table connect_profile_settings add column if not exists avatar_url text;

-- Upload : strictement scopé à son propre dossier avatars/<user_id>/... (le
-- segment 2 du chemin doit être l'auth.uid() de l'appelant) — même schéma que
-- la policy messages déjà en place.
drop policy if exists "portail_media_avatar_insert" on storage.objects;
create policy "portail_media_avatar_insert" on storage.objects for insert
  with check (
    bucket_id = 'portail-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Remplacement d'une photo existante (même chemin réutilisé) : autorisé dans
-- les mêmes conditions.
drop policy if exists "portail_media_avatar_update" on storage.objects;
create policy "portail_media_avatar_update" on storage.objects for update
  using (
    bucket_id = 'portail-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Lecture : déjà publique pour tout le bucket ("portail_media_public_read",
-- migration-portail-v14.sql) — aucune policy supplémentaire nécessaire, les
-- URLs publiques générées côté client (getPublicUrl) fonctionnent directement.

-- ============================================================
-- FIN. Aucune Edge Function à redéployer — upload direct client → Storage,
-- écriture de avatar_url directe (connect_profile_settings, déjà couverte
-- par la policy self existante "cps_self_all").
-- ============================================================
