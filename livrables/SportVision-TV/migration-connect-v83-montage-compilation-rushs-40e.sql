-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v83
-- Montage Compilation, mode "rushs_decoupes" : prix de base ramené à 40€ TTC.
--
-- Contexte (18/08/2026) : ce mode (≤6 min de rush déjà pré-découpé par le client) était à 48€ TTC
-- (prix_ht=40.00, migration-connect-v81), plus cher que le mode "lien_match" à 1 match (40€ TTC)
-- alors que SportVision y fait tout le travail de dérushage. Fouka a tranché : 40€ TTC, le rush
-- pré-découpé pouvant en réalité provenir de plusieurs matchs combinés (pas nécessairement moins
-- de travail que le mode lien_match).
--
-- prix_ht = 33.33 produit exactement 40,00€ TTC via le calcul TVA 20% de create-checkout-session
-- (33.33 * 1.20 = 39.996 → arrondi 40.00), même valeur que le palier "1 match" de tarif_lien_match
-- (migration-connect-v82).
--
-- DÉJÀ EXÉCUTÉE le 18/08/2026 via l'API Management Supabase — ce fichier documente le changement
-- a posteriori. Idempotente (simple UPDATE).
-- ============================================================

update catalogue_offres
set prix_ht = 33.33
where slug = 'montage-compilation';
