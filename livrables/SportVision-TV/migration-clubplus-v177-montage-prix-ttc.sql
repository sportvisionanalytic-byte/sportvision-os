-- v177 : le Montage & compilation s'affiche en TTC, comme toute la grille (12/09/2026).
--
-- Décision de Fouka, ce jour : le prix payé par le client ne bouge pas, c'est l'unité affichée qui
-- est corrigée. Le montage était la SEULE prestation annoncée hors taxes dans une grille grand
-- public entièrement TTC (120, 150, 160, 180 €). Un parent lisait « dès 39,90 € » et se serait vu
-- facturer 47,88 €.
--
-- En base, catalogue_offres.prix_ht porte bien un montant HORS TAXES pour toutes les autres
-- prestations (100 → 120 TTC, 125 → 150, 133,33 → 160, 150 → 180). Le montage y était à 39,90,
-- c'est-à-dire son prix TTC rangé dans la colonne hors taxes. Il passe à 33,25 (39,90 / 1,20),
-- ce qui redonne exactement 39,90 € TTC au client.
-- Test : tests/montage-prix-ttc.test.sql

update catalogue_offres
   set prix_ht = 33.25
 where nom = 'Montage Compilation' and prix_ht = 39.90;
