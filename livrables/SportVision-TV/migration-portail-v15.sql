-- ============================================================
-- SPORTVISION PORTAIL — Migration v15
-- Offre de bienvenue : -10% sur la première prestation pour tout compte créé
-- depuis le Portail. `promo_bienvenue_disponible` est mis à true uniquement
-- par portal-onboarding lors de la création d'un NOUVEAU client (jamais pour
-- un client déjà existant qui se rattache), et remis à false par le staff
-- dans l'OS quand la réduction est appliquée sur un devis (modalNouveauDevis).
-- Idempotente. À exécuter après migration-portail-v14.sql.
-- ============================================================

alter table clients add column if not exists promo_bienvenue_disponible boolean default false;
