-- ============================================================================
-- migration-planned-presences-match-link.sql (03/09/2026)
-- ============================================================================
-- Suite du Communication Hub (après migration-contenus-match-event-link.sql / "Matchs à venir" →
-- contenu) : réconcilier le planning éditorial CM (`planned_presences`) avec le vrai calendrier
-- Club+ (`club_matches`), au lieu de rester un système entièrement parallèle où équipe/date/
-- adversaire/lieu sont ressaisis à la main (modalNouvellePresence, `pp-eq`/`pp-dt`/`pp-ad`/`pp-li`).
--
-- Additif, nullable — ne touche à aucune donnée existante. `planned_presences.heure_debut` n'a
-- pas d'équivalent sur `club_matches` (le calendrier canonique ne suit pas l'heure d'un match,
-- seulement la date) : reste ressaisi manuellement même pour une présence liée à un match, c'est
-- attendu, pas un oubli.

alter table planned_presences add column if not exists match_id uuid references club_matches(id) on delete set null;

create index if not exists idx_pp_match on planned_presences(match_id) where match_id is not null;

comment on column planned_presences.match_id is 'Lien vers le match Club+ dont cette présence planifiée est issue — migration-planned-presences-match-link.sql, 03/09/2026. NULL pour une présence saisie librement (comme avant).';

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
--
-- select column_name from information_schema.columns where table_name='planned_presences'
--   and column_name='match_id'; -- 1 ligne attendue
-- ============================================================================
