-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v65
-- Montage Compilation, mode "rushs découpés" : au-delà de 6 minutes de rush déclarées, retire le
-- tarif fixe à 80€ HT (posé à titre provisoire par v63) et le remplace par "sur devis" — même
-- traitement que le mode "lien_match" au-delà de 4 matchs (migration-connect-v64).
--
-- Décision de Fouka (15/08) : garder le prix de base (39,90€ HT, ≤ 6 min) mais ne PAS fixer de
-- tarif automatique au-delà — trop de variabilité dans la durée totale d'un gros rush pour un
-- prix plat unique, contrairement au mode "lien_match" où le nombre de matchs donne un vrai
-- palier. Chiffrage manuel par le staff dans ce cas.
--
-- Effet technique : catalogue_offres.tarif_palier passe de
--   {"seuil_minutes": 6, "prix_ht_au_dela": 80.00}
-- à
--   {"seuil_minutes": 6}
-- (clé prix_ht_au_dela absente). create-checkout-session (déjà mis à jour pour lire cette absence
-- comme "aucun montant calculable") refuse alors le paiement en ligne au-delà de 6 min avec un
-- message explicite, exactement comme pour le mode lien_match au-delà de 4 matchs — le staff doit
-- chiffrer manuellement (montant_ttc) avant que le client puisse payer.
--
-- Idempotente (simple
-- UPDATE, sans risque à rejouer). Ne touche PAS au prix de base (prix_ht = 39,90€, toujours
-- provisoire au sens où il n'a jamais été formellement validé, mais Fouka a confirmé le garder
-- tel quel le 15/08).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- catalogue_offres.tarif_palier pour slug='montage-compilation' vaut
-- {"seuil_minutes": 6} (clé prix_ht_au_dela absente), exactement l'état
-- cible de cette migration. Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

update catalogue_offres
set tarif_palier = jsonb_build_object('seuil_minutes', 6)
where slug = 'montage-compilation';

-- ============================================================
-- FIN. Actions manuelles requises après relecture :
--   1. Exécuter ce fichier dans Supabase → SQL Editor (idempotent).
--   2. Redéployer create-checkout-session (déjà modifié pour ce changement) — PAS
--      connect-player-prestations (non touché ici, la capture de la durée déclarée est
--      inchangée), PAS stripe-webhook.
-- ============================================================
