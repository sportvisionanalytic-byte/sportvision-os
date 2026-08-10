-- ============================================================
-- SPORTVISION CONNECT — Migration v21 : vue `client_cm` — expose le
-- Community Manager assigné (`clients.cm_id`) aux membres autorisés du
-- club/client lié (module MyCM, app-next `/mycm`).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- `clients.cm_id` (migration-cm-tiers.sql, ligne 76) porte déjà le lien réel
-- CM ↔ client (portefeuille personnel). La policy `clients_cm_select_acces`
-- (même fichier, ~ligne 155) n'autorise à la lire QUE le CM lui-même, un
-- Lead CM, ou l'admin — jamais un membre côté club/client. C'est exactement
-- le trou que cette migration comble, en LECTURE SEULE, sans toucher à
-- cette policy (qui reste correcte pour son usage interne CM/staff).
--
-- Même patron exact que `client_devis`/`client_factures`/`client_contrats`
-- (migration-clubplus-v33-club-documents-access.sql) : une vue expose des
-- colonnes normalement protégées, filtrée par `club_member_has_client_access
-- (client_id)` (club, déjà exécutée/vérifiée en prod) et `client_users`
-- (Espace Projet générique). Aucune policy n'est ajoutée sur `clients` ou
-- `profiles` : ces deux tables restent fail-closed pour un client/membre de
-- club, la vue est le seul chemin d'accès — même principe que
-- migration-portail-v1.sql pour les 3 vues client_* d'origine.
--
-- ─── Colonnes exposées ───────────────────────────────────────────────────
-- clients.cm_id + profiles.prenom/nom/avatar_url/niveau_cm (colonnes
-- vérifiées réelles : prenom/nom/id → supabase-schema.sql ; avatar_url →
-- migration-profiles-extended.sql ; niveau_cm → migration-cm-tiers.sql).
-- `niveau_cm` est exposé tel quel (ex. "cm_confirme") — c'est à l'app-next
-- de le traduire en libellé lisible, pas à cette vue.
--
-- ─── Portée volontairement limitée à club + généraliste (Espace Projet) ──
-- `organizations.legacy_client_id` (migration-connect-v2, colonne posée le
-- 10/08) permettrait en théorie une branche coach/académie identique à la
-- branche club (via une jointure memberships → organizations). Elle n'est
-- PAS ajoutée ici : à la date d'écriture, aucun mécanisme n'écrit encore
-- cette colonne pour coach/académie (le pont "Documents ↔ Portail" décrit
-- au plan Phase 1 n'est pas construit dans `connect-org-signup`), et
-- `useClientId()` (app-next, data/shared/use-client-id.ts) ne résout de
-- toute façon un `client_id` que pour "club" et "generic" aujourd'hui — une
-- branche coach/académie serait du code mort non testable, pas une
-- supposition à deviner ici. À ajouter dans une migration ultérieure une
-- fois la Phase 1 posée et `legacy_client_id` réellement peuplé.
--
-- Idempotente : DROP VIEW IF EXISTS avant CREATE, peut être rejouée sans
-- effet de bord. À exécuter après migration-cm-tiers.sql,
-- migration-profiles-extended.sql et migration-clubplus-v33-club-
-- documents-access.sql (dont ce fichier réutilise club_member_has_client_
-- access() sans le redéfinir). Non exécutée par l'agent qui l'a écrite —
-- à exécuter manuellement par Fouka.
-- ============================================================

drop view if exists client_cm;
create view client_cm as
select
  cl.id as client_id,
  cl.cm_id,
  p.prenom,
  p.nom,
  p.avatar_url,
  p.niveau_cm
from clients cl
join profiles p on p.id = cl.cm_id
where cl.cm_id is not null
  and (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = cl.id)
    or club_member_has_client_access(cl.id)
  );

-- Note : comme les 3 vues client_* d'origine, pas de security_invoker —
-- exécution avec les droits du propriétaire (comportement par défaut
-- Postgres). Les privilèges SELECT sur la vue elle-même doivent être
-- accordés à `authenticated` si ce n'est pas déjà hérité par défaut sur ce
-- projet (vérifié aligné sur client_contrats : aucun GRANT explicite
-- supplémentaire n'a été nécessaire pour elle, donc aucun ajouté ici non
-- plus — à confirmer par Fouka si `client_cm` renvoie 42501 en test réel).
