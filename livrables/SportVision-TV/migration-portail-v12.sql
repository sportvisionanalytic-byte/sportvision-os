-- ============================================================
-- SPORTVISION PORTAIL — Migration v12
-- Frais de déplacement automatiques : quand le lieu de la prestation (saisi
-- dans le configurateur) est géolocalisé hors Île-de-France, le Portail
-- calcule la distance réelle depuis le siège (API adresse.data.gouv.fr,
-- gratuite, sans clé) et ajoute un forfait kilométrique. Ces deux colonnes
-- stockent le résultat du calcul pour que le staff le voie tel quel dans
-- l'OS, sans recalcul manuel.
-- Idempotente. À exécuter après migration-portail-v11.sql.
-- ============================================================

alter table prestations add column if not exists distance_km numeric(6,1);
alter table prestations add column if not exists frais_deplacement_ht numeric(8,2);
