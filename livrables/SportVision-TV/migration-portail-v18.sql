-- ============================================================
-- SPORTVISION PORTAIL — Migration v18
-- Aligne les délais affichés du catalogue sur le message "livraison express"
-- de la FAQ/à propos (24-48h max hors match). Shooting affichait "5 jours",
-- Tournoi/Stage affichaient "7 jours".
-- Idempotente. À exécuter après migration-portail-v17.sql.
-- ============================================================

update catalogue_offres set duree_estimee = '48h' where slug = 'shooting';
update catalogue_offres set duree_estimee = '48h' where slug = 'couverture-tournoi';
update catalogue_offres set duree_estimee = '48h' where slug = 'couverture-stage';
