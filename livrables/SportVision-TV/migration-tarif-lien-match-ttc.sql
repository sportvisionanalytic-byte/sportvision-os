-- Montage par lien de match : le prix affiché est le prix payé (12/09/2026).
--
-- Le site annonce « 1 match 40 € TTC, 2 matchs 55 €, 3 matchs 70 €, 4 matchs 80 € ». Ces mêmes
-- nombres étaient stockés dans `catalogue_offres.tarif_lien_match` comme des montants HT, et
-- `create-checkout-session` leur ajoute la TVA : le client voyait 40 € et payait 48 €.
--
-- C'est exactement le défaut corrigé ce matin sur le prix de base du Montage Compilation
-- (39,90 € affiché, 47,88 € encaissé), dont on n'avait traité qu'une moitié : le tarif au forfait.
-- Même décision que Fouka a prise ce matin : LE PRIX CLIENT NE BOUGE PAS. On corrige le HT pour
-- que le TTC tombe sur le montant annoncé.
--
--   1 match  : 40 € TTC → 33,33 € HT
--   2 matchs : 55 € TTC → 45,83 € HT
--   3 matchs : 70 € TTC → 58,33 € HT
--   4 matchs : 80 € TTC → 66,67 € HT
--
-- Au-delà de 4 matchs : sur devis, inchangé.
-- Idempotente.

update catalogue_offres
   set tarif_lien_match = '[{"nb_matchs":1,"prix_ht":33.33},
                            {"nb_matchs":2,"prix_ht":45.83},
                            {"nb_matchs":3,"prix_ht":58.33},
                            {"nb_matchs":4,"prix_ht":66.67}]'::jsonb
 where nom = 'Montage Compilation';
