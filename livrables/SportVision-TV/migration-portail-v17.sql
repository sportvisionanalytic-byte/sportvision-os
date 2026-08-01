-- ============================================================
-- SPORTVISION PORTAIL — Migration v17
-- Nouvelles prestations : Match filmé drone (120€ TTC) et le pack combiné
-- Drone + Photo (180€ TTC). Prix communiqués en TTC, stockés en HT
-- (HT = TTC / 1,2) comme le reste du catalogue.
-- Idempotente (upsert par slug). À exécuter après migration-portail-v16.sql.
-- ============================================================

insert into catalogue_offres (slug, nom, categorie, description, tarif_type, prix_ht, duree_estimee, livrables_inclus, options, ordre) values
('match-filme-drone', 'Match filmé drone', 'drone',
  'Captation vidéo aérienne de votre match par drone, prises de vue depuis les airs.', 'fixe', 100.00, '72h',
  'Vidéo drone montée, plans aériens du match',
  '[]', 10),

('combo-drone-photo', 'Combo Match filmé Drone + Photo', 'pack',
  'Captation vidéo aérienne par drone, combinée à un reportage photo par un opérateur SportVision.', 'fixe', 150.00, '72h',
  'Vidéo drone montée, 30 photos HD retouchées, galerie en ligne',
  '[]', 11)

on conflict (slug) do update set
  nom = excluded.nom, categorie = excluded.categorie, description = excluded.description,
  tarif_type = excluded.tarif_type, prix_ht = excluded.prix_ht, duree_estimee = excluded.duree_estimee,
  livrables_inclus = excluded.livrables_inclus, options = excluded.options, ordre = excluded.ordre;
