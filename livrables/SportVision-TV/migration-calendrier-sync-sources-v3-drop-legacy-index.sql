-- Migration : retrait de la contrainte d'anti-doublon historique (Lot 0, fin)
--
-- À exécuter APRÈS le déploiement de la phase TypeScript du chantier calendrier, jamais avant.
-- Ordre imposé : tant que l'ancienne version d'`importClubMatches()` est en ligne, elle fait
--     .upsert(..., { onConflict: "club_id,team,opponent,match_date" })
-- et Postgres refuse un ON CONFLICT qui ne désigne aucune contrainte existante
-- (« there is no unique or exclusion constraint matching the ON CONFLICT specification »).
-- Supprimer la contrainte avant le déploiement casserait donc l'import pendant toute la fenêtre
-- entre l'exécution SQL et la mise en ligne Netlify.
--
-- ── Ce qu'on retire, et pourquoi ──
-- `club_matches_no_reimport_dup (club_id, team, opponent, match_date)` a été posée le 04/09/2026
-- (migration-audit-transversal-fixes-batch1.sql) pour un besoin réel : « réimporter exactement le
-- même fichier → 0 doublon ». Elle le faisait, mais avec deux défauts que le Lot 0 corrige :
--
--   1. elle interdisait DEUX MATCHS LÉGITIMES le même jour contre le même adversaire à des heures
--      différentes — un tournoi, donc. La date seule ne suffit pas à identifier un match ;
--      club_matches n'avait alors pas de colonne heure, ce qui rendait le problème invisible.
--   2. elle porte sur `team` (texte libre) et sur `opponent` en respectant la casse : "FC Melun" et
--      "fc melun" y passaient tous les deux, alors que le nouvel index de repli, lui, les refuse.
--      C'est précisément la divergence qui a rendu nécessaire le correctif de dédup de la v1.
--
-- Les deux index du Lot 0 la remplacent intégralement, et couvrent strictement plus de cas :
--   club_matches_provider_external_uniq (club_id, provider, external_event_id)
--       where external_event_id is not null
--   club_matches_fallback_uniq (club_id, team_id, lower(opponent), match_date, kickoff_time)
--       nulls not distinct where external_event_id is null
-- plus le trigger trg_club_matches_zz_dedup, qui rend le réimport idempotent quel que soit
-- l'appelant.
--
-- ── Plus aucun appelant ──
-- `importClubMatches()` (lib/data/club/matches.ts) ne fait plus d'upsert : elle délègue au moteur
-- commun, qui résout l'identité puis fait un INSERT ou un UPDATE ciblé par id. Vérifié par
-- recherche sur tout le dépôt : aucune autre occurrence de "club_id,team,opponent,match_date" ni
-- de "club_matches_no_reimport_dup" en dehors des fichiers de migration.

begin;

alter table club_matches drop constraint if exists club_matches_no_reimport_dup;

commit;
