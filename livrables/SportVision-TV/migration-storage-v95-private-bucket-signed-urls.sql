-- ============================================================================
-- migration-storage-v95-private-bucket-signed-urls.sql
-- ============================================================================
-- SUITE de migration-storage-v94-restrict-sensitive-reads.sql : v94 avait
-- montré que scoper la policy SELECT sur un bucket PUBLIC ne suffit pas —
-- /object/public/<bucket>/<path> (celui que génère getPublicUrl(), utilisé par
-- toutes les balises <img>/<a href>) ignore la RLS tant que bucket.public=true,
-- et passer le bucket entier en privé casserait tout son contenu légitimement
-- public (logos, catalogue vitrine, avatars).
--
-- CE QUE FAIT CE FICHIER :
--   1. Nouveau bucket PRIVÉ dédié (sportvision-media-prive, créé via l'API
--      Storage juste avant ce fichier) — le contenu réellement sensible
--      (pièces jointes de messagerie client↔staff, pour l'instant) y migre.
--      family-docs/ n'est PAS repris ici : aucun code d'upload n'existe
--      encore pour cette fonctionnalité (voir INC-029), rien à migrer tant
--      qu'elle n'est pas construite — quand elle le sera, réutiliser ce même
--      bucket avec le même patron de policy.
--   2. Policies write/read scopées sur ce bucket pour messages/<client_id>/... :
--      mêmes vérifications que l'ancienne policy INSERT sur portail-media
--      (client_users propriétaire OU player_has_client_access), PLUS is_staff()
--      en écriture (le staff répond aussi avec pièce jointe depuis l'OS) et en
--      lecture (un CM/secrétaire doit voir une pièce jointe reçue).
--   3. Nouvelle colonne messages_client.piece_jointe_path (chemin de stockage,
--      PAS une URL) — l'ancienne colonne piece_jointe_url reste inchangée
--      pour compat mais n'est plus écrite pour les nouveaux messages : une URL
--      signée expire, il faut en regénérer une à chaque affichage depuis le
--      chemin, jamais stocker une URL signée en base comme si elle était
--      permanente.
--   4. messages_client était à 0 ligne au moment d'écrire ceci (voir INC-028) —
--      aucun backfill nécessaire, changement purement additif/prospectif.
-- ============================================================================

alter table messages_client add column if not exists piece_jointe_path text;

create policy "sv_media_prive_messages_insert" on storage.objects for insert
  with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'messages'
    and (
      exists (
        select 1 from client_users cu
        where cu.id = auth.uid()
          and cu.client_id::text = (storage.foldername(name))[2]
      )
      or player_has_client_access(((storage.foldername(name))[2])::uuid)
      or is_staff()
    )
  );

create policy "sv_media_prive_messages_select" on storage.objects for select
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'messages'
    and (
      exists (
        select 1 from client_users cu
        where cu.id = auth.uid()
          and cu.client_id::text = (storage.foldername(name))[2]
      )
      or player_has_client_access(((storage.foldername(name))[2])::uuid)
      or is_staff()
    )
  );

-- ============================================================================
-- Vérifié après écriture (E2E, objets/comptes jetables) :
-- 1) upload par le client propriétaire → succès, storage path stocké dans
--    piece_jointe_path (pas d'URL).
-- 2) createSignedUrl() par ce même client → succès, URL temporaire fonctionnelle.
-- 3) createSignedUrl() par un utilisateur authentifié SANS relation à ce
--    client → échoué (RLS refuse même la signature, pas seulement la lecture
--    directe — /object/sign/ respecte la policy SELECT).
-- 4) lecture directe /object/public/<bucket>/<path> sur ce bucket privé →
--    échoue systématiquement, quel que soit l'appelant (bucket.public=false,
--    pas de bypass possible contrairement à v94).
-- ============================================================================
