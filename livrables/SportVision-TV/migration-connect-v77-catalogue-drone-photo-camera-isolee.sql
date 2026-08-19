-- ============================================================
-- SPORTVISION CONNECT — Migration v77
-- Aligne catalogue_offres sur le site public : Combo Drone + Photo (prix figé depuis
-- longtemps à 160 € TTC sur le site vitrine) était en réalité facturé 180 € TTC côté base
-- (150 € HT) — écart trouvé lors de l'audit de finalisation Connect du 19/08/2026 (Connect
-- lit catalogue_offres en direct via fetchPlayerCatalogue, contrairement au tunnel /reserver
-- du site vitrine qui a des prix codés en dur dans le HTML). Fouka confirme 160 € TTC comme
-- le vrai prix.
--
-- Ajoute aussi Caméra isolée joueur (150 € TTC / 125 € HT), mise en avant sur le site public
-- depuis plusieurs sessions mais totalement absente de catalogue_offres — invisible dans
-- Connect en conséquence. categorie='video' (pas de nouvelle valeur ajoutée à la contrainte
-- CHECK catalogue_offres_categorie_check — 'video' est déjà mappé vers family="Match" et vers
-- l'icône "videocam", les deux corrects pour ce produit).
--
-- EXÉCUTÉE le 19/08/2026 via Supabase Management API, vérifiée par relecture des deux lignes
-- après exécution. Zéro commande existante sur combo-drone-photo (vérifié via
-- prestations.offre_id) : aucun client réel affecté par le changement de prix.
-- ============================================================

UPDATE catalogue_offres
SET prix_ht = 133.33
WHERE slug = 'combo-drone-photo';

INSERT INTO catalogue_offres (slug, nom, description, categorie, tarif_type, prix_ht, tva_pct, duree_estimee, livrables_inclus, options, ordre, actif)
VALUES (
  'camera-isolee',
  'Caméra isolée joueur',
  'Un suivi vidéo centré sur votre joueur pendant sa présence sur le terrain, pour un montage individuel.',
  'video',
  'fixe',
  125.00,
  20.00,
  '72h',
  'Montage individuel HD centré sur le joueur',
  '[]'::jsonb,
  12,
  true
);
