-- ============================================================================
-- migration-storage-v94-restrict-sensitive-reads.sql
-- ============================================================================
-- CONSTAT (audit externe du 20/08, §17 "P0 absolu" : buckets Storage publics) :
-- les 3 buckets Supabase Storage (club-logos, clubplus-media, portail-media)
-- ont chacun une policy SELECT (lecture) qui autorise TOUT LE MONDE (y compris
-- anonyme) sur TOUT le contenu du bucket, sans aucune restriction de chemin —
-- alors que les policies d'ÉCRITURE, elles, sont déjà correctement scopées :
--   - clubplus-media/family-docs/<player_id>/... : écriture réservée à
--     is_confirmed_parent_of(player_id) (autorisations parentales/documents
--     familiaux — clairement pensé comme privé par le code lui-même).
--   - portail-media/messages/<client_id>/... : écriture réservée au client
--     propriétaire (client_users) ou à un joueur avec accès à ce client
--     (player_has_client_access) — pièces jointes de messagerie privée.
-- Concrètement : n'importe qui peut aujourd'hui écrire (avec autorisation) une
-- pièce jointe de message privé ou un document familial sensible, mais
-- N'IMPORTE QUI peut aussi la LIRE ensuite, avec ou sans lien à disposition —
-- la policy SELECT ne fait aucune différence entre ce chemin et une photo de
-- catalogue marketing publique dans le même bucket.
--
-- VÉRIFIÉ AVANT D'ÉCRIRE CE FICHIER : les 2 dossiers concernés (family-docs/,
-- messages/) sont actuellement VIDES en production (0 fichier dans
-- clubplus-media et portail-media autre que portail-media/catalogue/, qui est
-- authentiquement du contenu marketing public). Donc aucune fuite de donnée
-- réelle n'a eu lieu à ce jour — c'est un correctif préventif d'une faille
-- structurelle, pas une réponse à une exposition déjà survenue.
--
-- CE QUE FAIT CE FICHIER (additif au sens fonctionnel : rien de public
-- aujourd'hui légitimement public ne devient privé) :
--   - club-logos : AUCUN changement — un logo de club est un asset destiné à
--     être affiché publiquement (image de marque), pas une donnée sensible.
--   - clubplus-media : la lecture reste publique pour tout le bucket SAUF le
--     préfixe family-docs/<player_id>/, désormais réservée au parent confirmé
--     de ce joueur (is_confirmed_parent_of) ou au staff SportVision (is_staff).
--   - portail-media : la lecture reste publique pour tout le bucket (dont
--     catalogue/, realisations/, avatars/) SAUF le préfixe messages/
--     <client_id>/, désormais réservée au client propriétaire (client_users),
--     à un joueur avec accès à ce client (player_has_client_access), ou au
--     staff SportVision (is_staff) — même granularité que la policy INSERT
--     déjà en place, avec l'ajout du staff en lecture (un CM/secrétaire doit
--     pouvoir voir une pièce jointe reçue d'un client).
-- ============================================================================

drop policy if exists "clubplus_media_public_read" on storage.objects;
create policy "clubplus_media_scoped_read" on storage.objects for select
  using (
    bucket_id = 'clubplus-media'
    and (
      (storage.foldername(name))[1] is distinct from 'family-docs'
      or is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
      or is_staff()
    )
  );

drop policy if exists "portail_media_public_read" on storage.objects;
create policy "portail_media_scoped_read" on storage.objects for select
  using (
    bucket_id = 'portail-media'
    and (
      (storage.foldername(name))[1] is distinct from 'messages'
      or (
        exists (
          select 1 from client_users cu
          where cu.id = auth.uid()
            and cu.client_id::text = (storage.foldername(name))[2]
        )
        or player_has_client_access(((storage.foldername(name))[2])::uuid)
        or is_staff()
      )
    )
  );

-- ============================================================================
-- LIMITE IMPORTANTE DÉCOUVERTE EN VÉRIFIANT CE FICHIER (20/08, à lire avant de
-- considérer ce correctif suffisant) :
-- Ces policies SELECT ne sont RÉELLEMENT appliquées que sur les endpoints
-- Storage qui respectent la RLS (/object/authenticated/, /object/sign/).
-- Or les 2 buckets concernés (portail-media, clubplus-media) ont
-- bucket.public=true, et l'endpoint /object/public/<bucket>/<path> — celui
-- que génère `getPublicUrl()` côté JS, utilisé PARTOUT dans le code (balises
-- <img src>, liens <a href> de pièce jointe) — sert le fichier SANS JAMAIS
-- consulter ces policies dès que le bucket est public. Testé en direct :
-- avec bucket.public=true, un objet messages/<client>/... reste lisible par
-- n'importe qui via /object/public/, malgré cette policy. Passer le bucket en
-- public=false corrige bien la lecture (vérifié) MAIS casse alors TOUT le
-- contenu légitimement public du même bucket (logos, catalogue vitrine,
-- avatars) car `getPublicUrl()` ne sait pas s'adapter — une balise <img src>
-- ne peut de toute façon pas envoyer d'en-tête d'authentification.
--
-- CONCLUSION : cette migration seule NE RÈGLE PAS le problème pour les
-- chemins sensibles (messages/, family-docs/) tant que le bucket reste
-- public — elle ajoute seulement une couche de défense correcte pour les
-- endpoints RLS-aware, utile mais insuffisante. Le vrai correctif nécessite
-- un bucket PRIVÉ dédié au contenu sensible + génération d'URLs signées
-- (temporaires) au moment de l'affichage, ce qui implique de modifier le
-- code d'upload ET d'affichage (au moins MessagesThread.tsx côté Connect,
-- et l'écran "Messages clients" côté OS) — pas fait cette nuit, voir
-- SPORTVISION_KNOWN_INCONSISTENCIES.md pour le détail et la suite prévue.
--
-- Bonne nouvelle vérifiée avant d'écrire tout ceci : family-docs/ n'a AUCUN
-- code d'upload réel nulle part dans le repo (policy DB créée mais fonctionnalité
-- jamais construite côté UI) — aucune exposition réelle possible aujourd'hui.
-- messages/ est une fonctionnalité active (MessagesThread.tsx) mais
-- `messages_client` est actuellement à 0 ligne (aucune pièce jointe n'existe
-- encore en production) — donc là non plus, aucune fuite de donnée réelle
-- n'a eu lieu à ce jour, uniquement une faille structurelle à corriger avant
-- un usage réel de la messagerie.
-- ============================================================================
