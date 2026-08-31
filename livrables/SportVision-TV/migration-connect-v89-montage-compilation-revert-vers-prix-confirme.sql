-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v89
-- Montage Compilation : revert vers le prix confirmé par Fouka (39,90€ HT / grille
-- 40-55-70-80€ HT), après divergence avec la vitrine publique.
--
-- Contexte (31/08/2026, audit de cohérence inter-systèmes vitrine/OS/Club+/Connect) :
-- pricing-config.js (source canonique de la vitrine) documente explicitement, dans son
-- propre commentaire d'en-tête, un "audit du 30/08" qui a corrigé les 5 pages vitrine
-- affichant "Montage & compilation" pour les faire converger sur les valeurs suivantes,
-- confirmées par Fouka :
--   - Rushs prédécoupés (≤6 min) : 39,90 € HT
--   - Grille lien_match :  1 match  = 40 € HT
--                          2 matchs = 55 € HT
--                          3 matchs = 70 € HT
--                          4 matchs = 80 € HT
--                          5 matchs et + : sur devis
--
-- Le backend (catalogue_offres, ce que create-checkout-session/index.ts lit réellement
-- pour calculer le montant facturé par Stripe) était resté sur les valeurs des migrations
-- v81/v82/v83 (18/08/2026, "tout en TTC et des prix ronds") :
--   - prix_ht = 33.33 (→ 40,00 € TTC arrondi, PAS 39,90 € HT / 47,88 € TTC)
--   - tarif_lien_match = 33.33/50.00/66.67/83.33 HT (→ 40/60/80/100 € TTC arrondis,
--     PAS 40/55/70/80 € HT / 48/66/84/96 € TTC)
--
-- Un client visitant la vitrine voyait donc un prix, et Stripe lui en facturait un autre
-- au moment du paiement — écart réel constaté en conditions live (lecture directe de
-- catalogue_offres le 31/08/2026), pas seulement un écart HT/TTC. Cette migration aligne
-- le backend sur le prix confirmé et affiché par la vitrine (source de vérité côté prix
-- publics, per pricing-config.js).
--
-- Si un futur arbitrage business décide de revenir à des prix TTC ronds (40/60/80/100€),
-- il faudra alors mettre à jour pricing-config.js EN PREMIER et le documenter comme
-- source canonique avant de rejouer un changement backend, pour ne pas reproduire cette
-- divergence.
--
-- DÉJÀ EXÉCUTÉE le 31/08/2026 via l'API Management Supabase — ce fichier documente le
-- changement a posteriori, cohérent avec la convention du projet. Idempotente (simple
-- UPDATE, sans risque à rejouer).
-- ============================================================

update catalogue_offres
set prix_ht = 39.90,
    tarif_lien_match = jsonb_build_array(
      jsonb_build_object('nb_matchs', 1, 'prix_ht', 40.00),
      jsonb_build_object('nb_matchs', 2, 'prix_ht', 55.00),
      jsonb_build_object('nb_matchs', 3, 'prix_ht', 70.00),
      jsonb_build_object('nb_matchs', 4, 'prix_ht', 80.00)
    ),
    updated_at = now()
where slug = 'montage-compilation';
