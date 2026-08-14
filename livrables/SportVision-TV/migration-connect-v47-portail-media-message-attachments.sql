-- ============================================================
-- Migration v47 - Pieces jointes Messages (Espace Joueur) dans portail-media
--
-- Contexte : chantier "Messages" de l'Espace Joueur (agent app-connect, 14/08). Le design impose
-- une piece jointe dans le composeur (design-connect-personnel-12-08/README.md section Messages).
-- Aucun flux d'upload de piece jointe cote client n'existait nulle part dans le code avant cet
-- agent (ni app-next, ni app-connect) : messages_client.piece_jointe_url n'etait ecrit que par le
-- staff/back-office. Le bucket "portail-media" (public, deja utilise pour les images du catalogue)
-- est le bucket le plus proche semantiquement (relation client personnelle "Portail"), mais son
-- unique policy INSERT generique est reservee au staff ("portail_media_admin_insert",
-- migration-portail-v14.sql) - un joueur authentifie ne peut donc pas y deposer de fichier
-- aujourd'hui, meme sous un chemin dedie.
--
-- Cette migration ajoute une policy INSERT additive, strictement scopee au dossier
-- messages/<client_id>/... et au client_id que l'appelant peut prouver via player_has_client_access
-- (ou client_users, meme logique que messages_client). Le chemin de l'objet encode le client_id
-- (storage.foldername(name) segmente le chemin par "/") ; toute tentative d'ecrire hors de son
-- propre dossier messages/<client_id>/ echoue.
--
-- NON EXECUTEE PAR L'AGENT qui l'a ecrite (aucun acces direct au Storage/SQL depuis ce worktree).
-- A relire puis executer par Fouka dans Supabase -> SQL Editor. Idempotente (drop policy if exists
-- avant chaque create policy). Sans cette migration, le bouton piece jointe de /messages echoue
-- proprement (message d'erreur affiche, aucun crash, aucune donnee fictive) - voir
-- MessagesThread.tsx:handleAttach.
-- ============================================================

drop policy if exists "portail_media_client_messages_insert" on storage.objects;
create policy "portail_media_client_messages_insert" on storage.objects for insert
  with check (
    bucket_id = 'portail-media'
    and (storage.foldername(name))[1] = 'messages'
    and (
      exists (
        select 1 from client_users cu
        where cu.id = auth.uid()
          and cu.client_id::text = (storage.foldername(name))[2]
      )
      or player_has_client_access(((storage.foldername(name))[2])::uuid)
    )
  );

-- Lecture : deja publique pour tout le bucket ("portail_media_public_read",
-- migration-portail-v14.sql), aucune policy supplementaire necessaire - les URLs de pieces
-- jointes generees par MessagesThread.tsx (getPublicUrl) fonctionnent donc directement une fois
-- l'insert ci-dessus applique.
