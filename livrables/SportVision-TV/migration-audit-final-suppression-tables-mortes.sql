-- ============================================================================
-- Suppression de 8 tables confirmées mortes (audit final 29/08/2026)
-- ============================================================================
-- Identifiées par l'audit schéma/cohérence (AUDIT_schema_donnees.md) : recherche
-- exhaustive en 3 passes (SportVision-OS-Full.html, tout le repo — Connect
-- app-next, Connect mobile, SportVision-Connect, edge functions — puis les
-- fonctions RPC Postgres via information_schema.routines) : 0 référence de
-- code trouvée nulle part pour aucune des 8, et 0 ligne de données.
-- Re-confirmé indépendamment le 29/08 avant suppression (grep exhaustif
-- répété, y compris un faux positif écarté : SportVision-Connect/app/modules/
-- joueur-espace.js mentionne favorite_collections uniquement dans un
-- commentaire d'en-tête listant les migrations lues — le code réel utilise
-- player_favorites, une table distincte, jamais favorite_collections).
--
-- webhook_events en particulier est un résidu confirmé d'une itération
-- antérieure du schéma d'idempotence webhook, remplacé depuis par les tables
-- dédiées stripe_events / youtrust_events (utilisées, elles, par
-- stripe-webhook/index.ts et youtrust-webhook/index.ts).
--
-- NON supprimée : la vue clubs_safe (également repérée sans référence de code
-- par l'audit) — laissée de côté volontairement : contrairement aux 8 tables
-- ci-dessous, elle a une définition qui trahit une intention de sécurité
-- claire (masquage conditionnel des champs financiers de `clubs` via
-- club_member_has_financial_view_access), qui ressemble à une préparation
-- pour un usage futur plutôt qu'un résidu abandonné — distinction jugée
-- suffisante pour ne pas la supprimer dans le même geste.
--
-- Schéma de chacune des 8 tables sauvegardé dans le message de commit associé
-- et dans le rapport d'audit, pour reconstruction si jamais l'une d'elles
-- s'avérait in fine nécessaire.
-- ============================================================================

drop table if exists public.calendar_sync_channels;
drop table if exists public.calendar_connections;
drop table if exists public.email_connections;
-- CASCADE : uniquement pour retirer la contrainte player_favorites_collection_id_fkey
-- (découverte à l'exécution), jamais exploitée par aucun code réel — player_favorites.
-- collection_id est écrit nulle part (vérifié : le seul INSERT réel, joueur-espace.js
-- ligne 619, ne renseigne jamais ce champ). Ne supprime ni la table player_favorites
-- ni sa colonne collection_id, seulement la contrainte de clé étrangère orpheline.
drop table if exists public.favorite_collections cascade;
drop table if exists public.formation_validations_terrain;
drop table if exists public.media_validations;
drop table if exists public.webhook_events;
drop table if exists public.whatsapp_opt_ins;
