-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v81
-- Montage Compilation : arrondit le prix de base HT pour obtenir un TTC rond.
--
-- Contexte (18/08/2026) : la vitrine publique affichait cette prestation en HT (39,90€ / 40-80€)
-- alors que tout le reste du catalogue public est en TTC — incohérence relevée en audit. Le
-- backend (create-checkout-session) calcule déjà le TTC via tva_pct (20%) au moment du paiement
-- Stripe, donc le montant réellement facturé n'a jamais changé de logique : seul le prix de base
-- affiché passe de 39,90€ HT à 40,00€ HT pour produire un TTC rond (48,00€ au lieu de 47,88€),
-- décision de Fouka ("tout en TTC et des prix rond").
--
-- Les 4 paliers "lien_match" (40/55/70/80€ HT → 48/66/84/96€ TTC) étaient déjà ronds en TTC,
-- aucun changement nécessaire dessus.
--
-- DÉJÀ EXÉCUTÉE le 18/08/2026 via l'API Management Supabase — ce fichier documente le changement
-- a posteriori, cohérent avec la convention du projet. Idempotente (simple UPDATE, sans risque à
-- rejouer).
-- ============================================================

update catalogue_offres
set prix_ht = 40.00
where slug = 'montage-compilation';
