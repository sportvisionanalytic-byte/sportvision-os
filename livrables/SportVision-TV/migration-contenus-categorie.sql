-- ============================================================================
-- migration-contenus-categorie.sql (03/09/2026)
-- ============================================================================
-- Complète le Communication Hub : `contenus.type_contenu` existant ne décrit que le FORMAT
-- (Vidéo/Photo/Story/Reel/Article/Post), jamais le PROPOS éditorial (Matchday/Composition/
-- Résultat/Interview...) — nécessaire pour que les obligations sponsor
-- (migration-club-sponsors-content-obligations.sql, club_sponsors.content_type_obligations)
-- puissent réellement matcher "ce sponsor doit apparaître sur tous les Matchday" sans dépendre
-- d'un pattern fragile sur le texte libre du titre. Colonne libre (pas de contrainte check stricte
-- — cohérent avec `type_contenu`, `plateforme`, qui restent des `text` libres dans ce schéma,
-- jamais des enums), nullable, additive.

alter table contenus add column if not exists categorie text;

comment on column contenus.categorie is 'Propos éditorial du contenu (Matchday, Composition, Résultat, Reel, Carrousel photo, Story, Interview, Autre...) — distinct de type_contenu (le format : Vidéo/Photo/Story/Reel/Article/Post). migration-contenus-categorie.sql, 03/09/2026.';

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
--
-- select column_name from information_schema.columns where table_name='contenus'
--   and column_name='categorie'; -- 1 ligne attendue
-- ============================================================================
