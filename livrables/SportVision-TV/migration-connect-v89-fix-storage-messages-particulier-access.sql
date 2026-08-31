-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v89
-- Corrige les policies storage.objects du bucket privé sportvision-media-prive pour le préfixe
-- messages/{client_id}/... : trouvé pendant l'audit "repasse fraîche" Espace particulier /
-- Messages du 31/08/2026 (compte de test test-audit-connect-repasse-*@sportvision-an.fr), en
-- comparant MessagesThread.tsx (handleAttach → storage.upload + createSignedUrl) et
-- messageAttachments.ts (resolveMessageAttachments → createSignedUrls) à la RLS réellement en
-- base sur ce bucket.
--
-- CAUSE : sv_media_prive_messages_insert / sv_media_prive_messages_select (créées avec le bucket
-- privé, migration-storage-v95 du 20/08) n'autorisent QUE :
--   1. client_users (compte lié historique)
--   2. player_has_client_access (nécessite une ligne player_profiles pour auth.uid())
--   3. is_staff()
--
-- Exactement la même incohérence que celle corrigée par migration-connect-v88-fix-client-mark-
-- message-read-particulier.sql sur client_mark_message_read : la RLS réelle de la table
-- messages_client (mc_client_select/mc_client_insert) reconnaît QUATRE chemins supplémentaires,
-- tous utilisés par l'Espace particulier et absents ici :
--   - club_member_has_client_access (déjà présent en RLS table, absent en storage)
--   - connect_owner_client_id(auth.uid()) = client_id     (compte particulier "self", sans club)
--   - connect_access_relationships (sportif "linked" avec right_voir accordé)
--   - managed_athlete_profiles (profil "géré" — enfant sans compte propre)
--
-- IMPACT réel : TOUT compte particulier (self, sportif lié, ou profil géré) envoyant une pièce
-- jointe depuis /particulier/messages reçoit un échec silencieux de l'upload Storage (RLS INSERT
-- refusée → "Impossible d'envoyer la pièce jointe pour le moment.", handleAttach) — et pour une
-- pièce jointe envoyée par le staff, createSignedUrls (resolveMessageAttachments) ne peut pas non
-- plus générer l'URL signée (RLS SELECT refusée) : pieceJointeUrl reste null, le message
-- s'affiche sans son lien de pièce jointe, sans erreur visible. Uniquement les comptes Espace
-- joueur affiliés à un club (player_profiles) fonctionnaient déjà.
--
-- CORRECTIF : aligne strictement ces deux policies storage sur la liste de conditions de
-- mc_client_select/mc_client_insert (même schéma que v88), en adaptant le chemin
-- (storage.foldername(name))[2] (client_id en position 2 du chemin messages/{client_id}/...) là
-- où la RLS table utilise directement messages_client.client_id.
-- ============================================================

drop policy if exists sv_media_prive_messages_insert on storage.objects;
create policy sv_media_prive_messages_insert on storage.objects
for insert
with check (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'messages'
  and (
    exists (
      select 1 from client_users cu
      where cu.id = auth.uid() and cu.client_id::text = (storage.foldername(name))[2]
    )
    or club_member_has_client_access(((storage.foldername(name))[2])::uuid)
    or player_has_client_access(((storage.foldername(name))[2])::uuid)
    or connect_owner_client_id(auth.uid()) = ((storage.foldername(name))[2])::uuid
    or exists (
      select 1 from connect_access_relationships car
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_voir
        and connect_owner_client_id(car.owner_user_id) = ((storage.foldername(name))[2])::uuid
    )
    or exists (
      select 1 from managed_athlete_profiles map
      where map.owner_user_id = auth.uid() and map.client_id = ((storage.foldername(name))[2])::uuid
    )
    or is_staff()
  )
);

drop policy if exists sv_media_prive_messages_select on storage.objects;
create policy sv_media_prive_messages_select on storage.objects
for select
using (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'messages'
  and (
    exists (
      select 1 from client_users cu
      where cu.id = auth.uid() and cu.client_id::text = (storage.foldername(name))[2]
    )
    or club_member_has_client_access(((storage.foldername(name))[2])::uuid)
    or player_has_client_access(((storage.foldername(name))[2])::uuid)
    or connect_owner_client_id(auth.uid()) = ((storage.foldername(name))[2])::uuid
    or exists (
      select 1 from connect_access_relationships car
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_voir
        and connect_owner_client_id(car.owner_user_id) = ((storage.foldername(name))[2])::uuid
    )
    or exists (
      select 1 from managed_athlete_profiles map
      where map.owner_user_id = auth.uid() and map.client_id = ((storage.foldername(name))[2])::uuid
    )
    or is_staff()
  )
);
