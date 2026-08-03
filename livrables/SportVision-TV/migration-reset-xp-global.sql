-- Migration : remise à zéro complète de l'XP, maintenant que le système est fiable
-- et restreint au rôle photographe/vidéaste.
--
-- Contexte : le système XP/Grade est désormais réservé au rôle 'photo' (les autres
-- rôles n'ont plus de parcours d'évolution). Avant de repartir sur des bases saines,
-- Fouka a demandé une réinitialisation complète de l'XP pour tout le monde : les
-- photographes/vidéastes recommenceront à en gagner naturellement via les missions,
-- formations et attributions manuelles ; les autres rôles resteront à 0 puisqu'ils
-- ne sont plus éligibles.
--
-- Le grade (profiles.grade) n'est PAS réinitialisé : il représente une évaluation
-- validée par l'Administrateur, indépendante du compteur XP gamifié. Une remise à
-- zéro de l'XP ne doit pas effacer une promotion déjà actée.
--
-- Idempotente : peut être rejouée sans effet supplémentaire (tout est déjà à 0/vide
-- après la première exécution).
-- À exécuter dans Supabase → SQL Editor.

-- 1. Vider l'historique des événements XP
delete from xp_events;

-- 2. Remettre à zéro le compteur XP de tous les profils
update profiles set xp = 0 where xp is distinct from 0;

-- 3. Remettre à zéro le rappel d'XP gagné sur les inscriptions formation
--    (champ informatif ; l'historique réel vit désormais uniquement dans xp_events)
update formation_inscriptions set xp_gagnes = 0 where xp_gagnes is distinct from 0;

-- 4. Purger les recommandations de grade en attente : elles référencent un XP qui
--    vient d'être remis à zéro et n'ont donc plus de sens.
delete from grade_recommendations where statut = 'en_attente';
