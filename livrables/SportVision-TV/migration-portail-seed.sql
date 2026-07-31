-- ============================================================
-- SPORTVISION PORTAIL — Catalogue de démarrage (optionnel)
-- Quelques prestations réelles pour tester le Portail de bout en bout.
-- Modifiable/complétable ensuite directement dans Supabase → Table Editor → catalogue_offres.
-- ============================================================

insert into catalogue_offres (slug, nom, categorie, description, tarif_type, prix_ht, duree_estimee, livrables_inclus, options, ordre) values
('match-photo', 'Match Photo', 'photo',
  'Suivi photo complet de votre match, livré en galerie en ligne.', 'fixe', 100, '48h',
  '30 photos HD retouchées, galerie en ligne partageable',
  '[{"nom":"Veo","prix_ht":30},{"nom":"Drone","prix_ht":25}]', 1),

('match-video', 'Match Vidéo', 'video',
  'Captation vidéo de votre match avec montage des temps forts.', 'fixe', 100, '72h',
  'Vidéo montée 3-5 min, version verticale Reel',
  '[{"nom":"Veo","prix_ht":30},{"nom":"Drone","prix_ht":25}]', 2),

('pack-match', 'Pack Match Complet', 'pack',
  'Photo et vidéo réunis pour une couverture complète de votre match.', 'fixe', 133.33, '72h',
  '30 photos HD, vidéo montée, galerie en ligne',
  '[{"nom":"Veo","prix_ht":30},{"nom":"Drone","prix_ht":25}]', 3),

('shooting', 'Shooting', 'shooting',
  'Séance photo individuelle ou de communication, pour construire votre image.', 'sur_devis', null, '5 jours',
  'Photos HD retouchées, formats réseaux sociaux', '[]', 4),

('couverture-tournoi', 'Couverture Tournoi', 'tournoi',
  'Couverture photo et vidéo complète d''un tournoi sur une ou plusieurs journées.', 'sur_devis', null, '7 jours',
  'Galerie complète, aftermovie, contenus réseaux', '[]', 5),

('couverture-stage', 'Couverture Stage', 'stage',
  'Immortalisez un stage sportif du premier au dernier jour.', 'sur_devis', null, '7 jours',
  'Galerie photo, vidéo récap', '[]', 6),

('creation-contenu', 'Création de contenu', 'contenu',
  'Production de contenus réguliers pour vos réseaux sociaux.', 'sur_devis', null, 'Sur devis',
  'Contenus adaptés par plateforme, calendrier éditorial', '[]', 7)

on conflict (slug) do nothing;
