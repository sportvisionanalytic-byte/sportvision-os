-- ============================================================================
-- migration-recrutement-v2-permis-vehicule.sql
-- ============================================================================
-- Ajout demandé par Fouka le 21/08/2026 : le poste implique de se déplacer
-- entre différents terrains/clubs de la zone couverte, donc permis et
-- véhicule personnel sont des critères utiles au tri des candidatures.
-- Colonnes texte 'oui'/'non', même patron que `materiel` (déjà dans v1).
-- ============================================================================

alter table recruitment_applications add column if not exists permis text;
alter table recruitment_applications add column if not exists vehicule text;
