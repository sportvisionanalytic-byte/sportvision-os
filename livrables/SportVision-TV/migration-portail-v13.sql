-- ============================================================
-- SPORTVISION PORTAIL — Migration v13
-- Vrais tarifs du catalogue (remplace les prix factices du seed initial)
-- et deux nouvelles prestations Veo. Les prix communiqués par Fouka sont en
-- TTC (prix client) ; catalogue_offres.prix_ht est stocké HT, le Portail
-- l'affiche en TTC (× 1,2). Conversion : HT = TTC / 1,2.
-- Idempotente (upsert par slug). À exécuter après migration-portail-v12.sql.
-- ============================================================

update catalogue_offres set prix_ht = 100.00,
  options = '[{"nom":"Veo","prix_ht":25.00},{"nom":"Drone","prix_ht":33.33}]'
  where slug = 'match-photo';

update catalogue_offres set prix_ht = 100.00,
  options = '[{"nom":"Veo","prix_ht":25.00},{"nom":"Drone","prix_ht":33.33}]'
  where slug = 'match-video';

update catalogue_offres set prix_ht = 133.33,
  options = '[{"nom":"Veo","prix_ht":25.00},{"nom":"Drone","prix_ht":33.33}]'
  where slug = 'pack-match';

insert into catalogue_offres (slug, nom, categorie, description, tarif_type, prix_ht, duree_estimee, livrables_inclus, options, ordre) values
('match-camera-veo', 'Match filmé caméra Veo', 'veo',
  'Captation vidéo automatisée de votre match par caméra Veo, sans opérateur sur place.', 'fixe', 91.67, '72h',
  'Vidéo Veo complète, montage automatique des temps forts',
  '[{"nom":"Drone","prix_ht":33.33}]', 8),

('combo-veo-photo', 'Combo Match filmé Veo + Photo', 'pack',
  'Captation vidéo automatisée par caméra Veo, combinée à un reportage photo par un opérateur SportVision.', 'fixe', 141.67, '72h',
  'Vidéo Veo montée, 30 photos HD retouchées, galerie en ligne',
  '[{"nom":"Drone","prix_ht":33.33}]', 9)

on conflict (slug) do update set
  nom = excluded.nom, categorie = excluded.categorie, description = excluded.description,
  tarif_type = excluded.tarif_type, prix_ht = excluded.prix_ht, duree_estimee = excluded.duree_estimee,
  livrables_inclus = excluded.livrables_inclus, options = excluded.options, ordre = excluded.ordre;
