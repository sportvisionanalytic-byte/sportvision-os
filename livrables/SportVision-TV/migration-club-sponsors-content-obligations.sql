-- ============================================================================
-- migration-club-sponsors-content-obligations.sql (03/09/2026)
-- ============================================================================
-- Suite du Communication Hub (après match→contenu et planning→match) : "si le sponsor principal
-- doit apparaître sur tous les Matchday, le CM ne devrait pas avoir à s'en souvenir à chaque
-- fois." Audit confirmé : `club_sponsors` n'a aujourd'hui aucun moyen de déclarer qu'un sponsor
-- doit apparaître sur un TYPE de contenu précis — seulement `commitments` (jsonb, une checklist
-- générique déjà exposée dans l'onglet "Contreparties" de Club+, sans lien avec les types de
-- contenu). Cette migration ajoute une colonne dédiée, simple et explicite, plutôt que de
-- surcharger `commitments` avec une sémantique différente.

alter table club_sponsors add column if not exists content_type_obligations text[] not null default '{}';

comment on column club_sponsors.content_type_obligations is 'Types de contenu (valeurs de contenus.type_contenu, ex. "Matchday") où ce sponsor doit obligatoirement apparaître — migration-club-sponsors-content-obligations.sql, 03/09/2026. Tableau vide par défaut = aucune obligation automatique (comportement actuel inchangé).';

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
--
-- select column_name, data_type from information_schema.columns where table_name='club_sponsors'
--   and column_name='content_type_obligations'; -- 1 ligne attendue
-- ============================================================================
