-- Migration : annexes opérationnelles de la formation Photographe-Vidéaste Sportif
-- Publie les 12 check-lists / grilles du programme comme Ressources dans le
-- Centre SportVision (visibles par toute l'équipe), puisqu'elles ne sont pas
-- rattachées à un module de formation précis.
-- Nécessite migration-centre-ressources.sql déjà exécutée.
-- Idempotente : les INSERT sont protégés par une vérification d'existence sur le titre.
-- À exécuter dans Supabase → SQL Editor

insert into centre_ressources (titre, description, type, contenu, icone, ordre, actif)
select * from (values
('Check-list matériel avant départ', 'À vérifier avant chaque prestation', 'texte', $$- Brief lu et mission confirmée
- Boîtier et objectif testés
- Deux batteries minimum
- Cartes formatées après sauvegarde
- Lecteur SD, ordinateur et disque dur
- Tenue SportVision
- Protection pluie et chiffon
- Adresse, contact et marge de trajet
- Réglages photo/vidéo mémorisés
- Plan de secours identifié$$, '🎒', 1, true),

('Réglages de départ recommandés', 'Bases de réglage selon le contexte', 'texte', $$Photo jour : AF-C, suivi sujet, RAW, rafale adaptée, vitesse 1/1000s à ajuster
Photo nuit : priorité à la vitesse, ouverture maximale, ISO auto plafonné selon le boîtier
Vidéo standard : 4K 25p, vitesse proche de 1/50s, balance fixe
Vidéo ralenti : 4K/HD 50p, vitesse proche de 1/100s
Interview : 4K 25p, exposition et balance manuelles, son contrôlé au casque

Toujours adapter au sport, à la lumière et au brief.$$, '⚙️', 2, true),

('Liste de plans match / tournoi', 'Séquences à ne pas oublier en couverture complète', 'texte', $$- Arrivée et installation
- Échauffement
- Entrée des équipes
- Plans larges du terrain
- Actions et duels
- Banc et coach
- Réactions et célébrations
- Public et bénévoles
- Sponsors et signalétique
- Remise de prix / fin de match
- Plans verticaux
- Séquences de sécurité$$, '📋', 3, true),

('Arborescence projet SportVision', 'Structure de dossiers standard pour chaque prestation', 'texte', $$01_RAW_PHOTO
02_RAW_VIDEO
03_AUDIO
04_PROJET_LIGHTROOM
05_PROJET_MONTAGE
06_GRAPHISMES
07_EXPORTS_MASTER
08_EXPORTS_SOCIAUX
09_LIVRAISON_CLIENT
10_ARCHIVES_ET_RAPPORT$$, '🗂️', 4, true),

('Check-list Lightroom', 'Points de contrôle avant export photo', 'texte', $$- Import depuis le bon dossier
- Métadonnées appliquées
- Tri en plusieurs passes
- Balance des blancs cohérente
- Exposition et hautes lumières
- HSL et couleurs du club
- Bruit et netteté à 100%
- Masques sans halo
- Contrôle de série
- Export web et HD testé$$, '📸', 5, true),

('Check-list montage vidéo', 'Points de contrôle avant export vidéo', 'texte', $$- Projet et séquence nommés
- Rushs organisés
- Actions marquées
- Hook présent
- Rythme lisible
- B-roll suffisant
- Titres et sous-titres relus
- Musique autorisée
- Mix audio sans saturation
- Colorimétrie cohérente
- Export et fichier final vérifiés$$, '🎬', 6, true),

('Check-list colorimétrie', 'Points de contrôle avant validation de l''étalonnage', 'texte', $$- Espace colorimétrique identifié
- Plan de référence choisi
- Waveform contrôlée
- Dominantes vérifiées sur parade RGB
- Saturation contrôlée au vectorscope
- Peaux et maillots justes
- Plans multi-caméras harmonisés
- Look appliqué après correction
- Sortie Rec.709 vérifiée
- Contrôle sur téléphone$$, '🎨', 7, true),

('Check-list Veo', 'Points de contrôle installation et récupération caméra Veo', 'texte', $$- Batterie et stockage
- Fixation et trépied
- Position centrale et dégagée
- Événement sélectionné
- Aperçu vérifié
- Enregistrement lancé
- Contrôle mi-temps
- Arrêt propre
- Téléversement lancé
- Traitement et client vérifiés$$, '📹', 8, true),

('Check-list drone', 'Points de contrôle avant tout vol', 'texte', $$- Mission validée
- Télépilote qualifié
- Zone et restrictions vérifiées
- Météo compatible
- Batterie et hélices
- Point de décollage sécurisé
- Personnes et distances
- Drone en vue
- Plans courts et stables
- Fichiers sauvegardés et rapport rempli$$, '🚁', 9, true),

('Rapport de mission — modèle', 'Éléments à renseigner après chaque prestation', 'texte', $$- Client et événement
- Date, horaires et lieu
- Opérateur et kit
- Contenus réalisés
- Fichiers et copies
- Délai prévu et statut
- Incident ou retard
- Demande supplémentaire du client
- Matériel à contrôler
- Action suivante$$, '📝', 10, true),

('Grille de progression étoiles', 'Critères d''évaluation de la progression collaborateur', 'texte', $$- Qualité photo
- Qualité vidéo
- Postproduction photo
- Montage et audio
- Colorimétrie
- Ponctualité
- Réactivité
- Organisation des fichiers
- Gestion du kit
- Relation client
- Autonomie
- Capacité à former ou référer$$, '⭐', 11, true),

('Certification finale — barème', 'Répartition des points de l''épreuve finale (100 pts, 80 requis, sans faute critique)', 'texte', $$Quiz théorique : 20 points
Préparation et check-list : 10 points
Photo sportive : 15 points
Vidéo sportive : 15 points
Postproduction photo : 10 points
Montage et audio : 15 points
Colorimétrie : 5 points
Organisation et sauvegarde : 5 points
Posture et soutenance : 5 points

Validation à 80/100 sans faute critique.$$, '🏆', 12, true)
) as v(titre, description, type, contenu, icone, ordre, actif)
where not exists (select 1 from centre_ressources cr where cr.titre = v.titre);
