-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v82
-- Montage Compilation, mode "lien_match" : nouvelle grille tarifaire.
--
-- Contexte (18/08/2026) : Fouka juge l'ancienne grille (40/55/70/80€ HT pour 1/2/3/4 matchs,
-- migration-connect-v64) incohérente — l'écart entre 3 et 4 matchs (70→80€, seulement +10€) ne
-- reflète pas le temps réel de dérushage d'un match complet supplémentaire. Nouvelle grille,
-- progression régulière à +20€ TTC par match :
--   1 match  : 40€ TTC
--   2 matchs : 60€ TTC
--   3 matchs : 80€ TTC
--   4 matchs : 100€ TTC
--   5 matchs et + : sur devis (déjà le comportement par défaut au-delà du nb_matchs max défini,
--   aucun changement de logique nécessaire — voir migration-connect-v64 §1).
--
-- Les montants HT stockés (33.33/50.00/66.67/83.33) sont calculés pour produire exactement ces
-- totaux TTC ronds via le calcul TVA 20% déjà en place dans create-checkout-session
-- (totalTtc = Math.round(baseHt * 1.20 * 100) / 100) :
--   33.33 * 1.20 = 39.996 → arrondi 40.00
--   50.00 * 1.20 = 60.00
--   66.67 * 1.20 = 80.004 → arrondi 80.00
--   83.33 * 1.20 = 99.996 → arrondi 100.00
--
-- Le mode "rushs_decoupes" (≤6 min, migration-connect-v63/v65) n'est PAS concerné par ce
-- changement — reste à 40€ HT / 48€ TTC.
--
-- DÉJÀ EXÉCUTÉE le 18/08/2026 via l'API Management Supabase — ce fichier documente le changement
-- a posteriori, cohérent avec la convention du projet. Idempotente (simple UPDATE).
-- ============================================================

update catalogue_offres
set tarif_lien_match = jsonb_build_array(
  jsonb_build_object('nb_matchs', 1, 'prix_ht', 33.33),
  jsonb_build_object('nb_matchs', 2, 'prix_ht', 50.00),
  jsonb_build_object('nb_matchs', 3, 'prix_ht', 66.67),
  jsonb_build_object('nb_matchs', 4, 'prix_ht', 83.33)
)
where slug = 'montage-compilation';
