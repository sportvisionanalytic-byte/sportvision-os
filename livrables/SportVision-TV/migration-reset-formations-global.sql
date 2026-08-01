-- Migration : remise à zéro complète des formations pour tout le monde.
--
-- Contexte : Fouka a demandé à repartir sur des bases saines sur le Centre de
-- formation, en plus de la remise à zéro de l'XP (migration-reset-xp-global.sql).
-- Tout collaborateur ayant commencé ou terminé une formation (progression,
-- inscription, quiz, certification obtenue) repart de zéro sur le catalogue
-- actuel de formations.
--
-- Ordre des opérations : on supprime d'abord les certifications obtenues, puis
-- la progression détaillée (leçons cochées), puis les inscriptions elles-mêmes
-- (qui portent le statut, le score de quiz et l'XP gagné).
--
-- Note : l'XP n'a pas besoin d'être retouché ici — migration-reset-xp-global.sql
-- a déjà vidé xp_events et remis profiles.xp à 0 pour tout le monde.
--
-- Idempotente : peut être rejouée sans effet supplémentaire (les tables sont
-- déjà vides après la première exécution).
-- À exécuter dans Supabase → SQL Editor.

-- 1. Supprimer toutes les certifications obtenues via des formations
delete from collaborateur_certifications;

-- 2. Supprimer toute la progression détaillée (leçons cochées)
delete from formation_progression;

-- 3. Supprimer toutes les inscriptions aux formations (statut, quiz, xp_gagnes)
delete from formation_inscriptions;
