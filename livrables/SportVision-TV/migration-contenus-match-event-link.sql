-- ============================================================================
-- migration-contenus-match-event-link.sql (03/09/2026)
-- ============================================================================
-- Première pièce du chantier "Communication Hub" (prompt Fouka du 03/09/2026, choisi après le
-- chantier effectifs/Smart Links/QR) : "un match existant devient cliquable pour générer un
-- contenu (Matchday, Résultat, Reel...) sans ressaisir club/équipe/date/lieu."
--
-- Audit préalable (agent, 03/09/2026) confirmé en direct sur le schéma LIVE (pas seulement les
-- fichiers .sql, plusieurs colonnes de `contenus` existant en prod sans migration versionnée) :
-- `contenus` n'a aujourd'hui AUCUN lien vers un match/événement réel — seulement `client_id`
-- (texte, vers `clients`) et un `sponsor` texte libre. `club_matches.contents` (jsonb, prévue
-- dès migration-clubplus-v3.sql) est un champ mort, jamais lu/écrit nulle part. Les écrans CM
-- existants (`loadCmPlanningMensuel`/`monthly_production_plans`/`planned_presences`) sont un
-- système ENTIÈREMENT PARALLÈLE où équipe/adversaire/lieu sont ressaisis à la main, déconnecté de
-- `club_matches` (le vrai calendrier canonique déjà utilisé par Club+) — exactement le problème
-- à corriger, pas à dupliquer davantage.
--
-- Cette migration ajoute UNIQUEMENT le lien manquant (match_id/calendar_event_id sur `contenus`),
-- nullable, additif, ne touche à aucune donnée existante. La réconciliation complète de
-- `monthly_production_plans`/`planned_presences` avec `club_matches` reste un chantier séparé,
-- plus lourd, volontairement hors périmètre de cette migration.

alter table contenus add column if not exists match_id uuid references club_matches(id) on delete set null;
alter table contenus add column if not exists calendar_event_id uuid references club_calendar_events(id) on delete set null;

create index if not exists idx_contenus_match on contenus(match_id) where match_id is not null;
create index if not exists idx_contenus_calendar_event on contenus(calendar_event_id) where calendar_event_id is not null;

comment on column contenus.match_id is 'Lien vers le match Club+ dont ce contenu est issu (Matchday, Résultat, Reel...) — migration-contenus-match-event-link.sql, 03/09/2026. NULL pour un contenu libre (recrutement, sponsor, actualité...), comme avant.';
comment on column contenus.calendar_event_id is 'Lien vers l''événement Club+ (tournoi, Media Day...) dont ce contenu est issu. NULL pour un contenu libre ou lié à un match (voir match_id).';

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select column_name from information_schema.columns where table_name='contenus'
--   and column_name in ('match_id','calendar_event_id'); -- 2 lignes attendues
-- Créer un contenu de test avec match_id renseigné, vérifier la jointure
--   contenus.match_id -> club_matches.id -> club_matches.club_id fonctionne pour retrouver
--   équipe/adversaire/date sans ressaisie.
-- ============================================================================
