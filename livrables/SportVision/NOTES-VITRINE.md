# Vitrine publique SportVision — Notes de livraison

Complète `index.html`. Couvre les points du brief qui ne sont pas du code : analyse des références, contenu à fournir, SEO, administration, pages restantes.

---

## 0. Ajout du 17/08/2026 — 2 nouvelles prestations mises en avant

Sur demande directe de Fouka ("en ce moment on me contacte beaucoup pour les montages compilation, prestation caméra isolée") : deux prestations jusque-là jamais isolées du catalogue (seulement mentionnées en creux dans "Match vidéo") ont chacune reçu leur propre fiche, avec un vrai extrait vidéo (ffmpeg, rushs fournis par Fouka).

- `prestation-camera-isolee.html` — Caméra isolée joueur, tarif "Sur devis".
- `prestation-montage-compilation.html` — Montage & compilation vidéo, tarif "Sur devis".
- Mises en avant en premier dans la grille "Prestations les plus demandées" de la home (badge "Très demandé"), dans une section dédiée de `prestations.html`, et comme need-cards dans `reserver.html` (slugs `camera-isolee`/`montage-compilation`).
- Liens ajoutés dans le menu déroulant "Prestations" (desktop + mobile) sur les 30 autres pages HTML du site (script Python, insertion après "Pack Match Complet" — vérifié fichier par fichier).
- Extraits vidéo réels : `assets/realisations/videos/reel-camera-isolee-01.mp4` et `reel-compilation-veo-01.mp4` (15s, 720×1280, encodés depuis les rushs de `context/import/banque contenue Sportvision/nos prestation/`), + posters correspondants.
- **Tarifs confirmés par Fouka (17/08, plus tard dans la soirée)** et appliqués partout (2 fiches, homepage, catalogue, `reserver.html`) :
  - Caméra isolée joueur : **150 € TTC** par joueur suivi (plusieurs joueurs = sur devis).
  - Montage & compilation : tarif déjà défini côté Connect (migration-connect-v63/v64/v65, confirmé par Fouka le 15/08) — **39,90 € HT** si rushs pré-découpés (≤6 min, au-delà sur devis), ou **40/55/70/80 € HT** pour 1 à 4 matchs via lien (au-delà sur devis). Détaillé dans un vrai tableau tarifaire sur `prestation-montage-compilation.html`.
  - Combo Drone + Photo (`reserver.html`) : ajusté de 180 € → **160 € TTC** (même tarif que Photo + Veo).
  - Nouveau pack "Photo + Vidéo + Highlight 4K" ajouté dans `reserver.html` (slug `pack-photo-video-highlight`) : **180 € TTC**.
  - "Match vidéo" relabellisé "Match filmé Veo" dans `reserver.html` (même prix 120 €, juste plus précis).
  - 3 clips vidéo caméra isolée supplémentaires ajoutés (rushs fournis par Fouka) dans la galerie homepage + galerie complète.

## 0 bis. Ajout du 17/08/2026 — contenu réel (logos, galerie, témoignages)

- **Logos partenaires** (barre de confiance) : 7 vrais logos remplacent le texte seul (`assets/partners/` — RC Pays de Fontainebleau, FC Varenne Féminine, ASA Montereau, ES Colombienne, Elite Sports Camps Horizon, Roi du Béton, Alchimist Performance).
- **Section témoignages** reconstruite avec 6 vrais avis clients (captures WhatsApp/Instagram fournies par Fouka) — attribution par rôle/club, jamais le pseudo brut, par respect de la vie privée.
- **Galerie Réalisations** enrichie de 7 nouveaux visuels réels (ASA Montereau, ES Colombienne montée R2, FC Varennes montée, tournoi international Sens, académie Petrus vs Leeds/Sunderland) + 2 études de cas illustrées (FC Varennes, ES Colombienne).
- Contenu source : `context/import/banque contenue Sportvision/` (178 fichiers fournis, sélection curatée — pas un import brut, chaque photo/vidéo a été regardée avant d'être retenue).
- **Nouveau logo + charte graphique (DA)** fournis par Fouka mais **pas appliqués** : rangés dans `assets/brand/` (`sportvision-logo-2026.png`, `DA-visuel-2026.png`). Toucherait le header de toutes les pages + une palette légèrement différente (accent rose en plus) — décision à prendre avec Fouka avant d'y toucher.
- Vidéos brutes ("nos prestation") trop volumineuses pour le site telles quelles (jusqu'à 760 Mo) — seuls 2 extraits de 15s ont été recadrés/compressés (voir § 0 ci-dessus), le reste du dossier reste en source.

## 0 ter. Ajout du 17-18/08/2026 — logo réel + audit de couverture image/vidéo

- **Logo réel appliqué** partout (header + footer, 34 pages) : `assets/brand/logo-mark.png` remplace le "S" généré en CSS. Décision distincte de la charte graphique complète (DA, palette, typographies) : celle-ci reste en réserve (`assets/brand/DA-visuel-2026.png`), pas appliquée — seul le logo a été demandé explicitement ("logo si il faut").
- Favicon **volontairement laissé tel quel** (SVG simple, déjà propre à 16/32px) : le nouveau logo, très détaillé, perdrait en lisibilité à cette taille.
- **Audit de couverture** : sur les 19 pages `feature-visual` (club-plus, full-communication×5, accompagnements×5, prestation-*×9), une seule illustration manquante trouvée (`prestation-shooting-joueur.html`, section Options) — le reste du site était déjà entièrement illustré avec de vrais visuels depuis une session antérieure. Corrigée avec une vraie photo (`foot-portrait-05.jpg`).
- **18/08 : les 6 études de cas sont maintenant toutes illustrées.** Brunoy FC (aucun contenu disponible) remplacé par TSF — Tournoi Sans Frontière, Sens (réutilise la photo déjà en galerie). ASA Montereau : nouvelle photo de célébration + légende corrigée en "match capté au plus près de l'action" (le "shooting collectif" initialement décrit n'a jamais eu de photo correspondante, donc le texte a changé plutôt que d'inventer une photo). Elite Sport Camp Horizon : vraie photo de stage (dossier import "stage de foot", confirmé par Fouka). FC Milly-Gâtinais : extrait vidéo réel du tournoi (`reel-tournoi-milly-01.mp4`), pas juste une photo. Les 6 cartes sont aussi devenues cliquables (photo → modal plein écran, vidéo → lecteur modal), réutilisant openPhoto()/openVideo() déjà en place pour la galerie Réalisations.

---

## 1. Ce qui a été livré

`livrables/SportVision/index.html` — page d'accueil publique complète, un seul fichier autonome (HTML/CSS/JS, aucune dépendance sauf les polices Google Fonts Manrope/Inter), sans authentification requise. Sections construites, dans l'ordre du brief : header, hero, barre de confiance, problème, démonstration, 5 sections fonctionnelles alternées, avant/après, solutions par profil (onglets), offres, services, réalisations (galerie filtrable), études de cas, témoignages, comment ça marche, aperçu de l'app privée, FAQ (accordéon), CTA final, footer complet. Le bouton "Se connecter" et tous les CTA de connexion pointent vers `../SportVision-Connect/app/index.html`.

**Le formulaire "Demander une démonstration" est réellement fonctionnel** : il appelle l'edge function `create-guest-request` déjà déployée et utilisée par Connect (même backend, même table `prestations`/`clients`, protection anti-bot honeypot + limite de fréquence déjà en place côté serveur) — pas un formulaire décoratif.

## 2. Analyse des références (Once Sport / Metrica Sports)

Principes structurants repris (jamais leurs textes, visuels ou code) :
- **Promesse immédiate dans le hero**, avant tout scroll — une phrase, pas un paragraphe.
- **Mise en scène du produit très tôt** : le hero montre déjà un mockup de l'interface, pas seulement une photo sportive.
- **Alternance texte/visuel** section par section, jamais deux sections identiques à la suite.
- **Bénéfices présentés comme des résultats concrets** ("suivez chaque prestation"), pas comme des specs techniques.
- **Preuve sociale répétée** : logos, chiffres, témoignages à plusieurs endroits de la page, pas une seule fois.
- **CTA répété** à chaque section clé, jamais un seul bouton en haut de page.
- **Densité maîtrisée** : peu de texte par bloc, hiérarchie typographique forte (Manrope 800 pour les titres).

Ce qui a été délibérément différent : palette et identité propres à SportVision (bleu nuit/bleu électrique/violet, fournie par le fondateur), vocabulaire et exemples issus du football amateur français, aucune reprise de mise en page identique à l'identique.

## 3. Contenu à fournir avant publication réelle

Rien n'est en Lorem Ipsum, mais plusieurs éléments sont des **placeholders explicitement signalés comme tels** ici, conformément à la consigne de ne jamais présenter un chiffre ou un témoignage non validé comme réel :

| Élément | État actuel | À faire avant publication |
|---|---|---|
| Témoignages (section "Ce qu'en disent nos clients") | **17/08/2026 : section reconstruite avec 6 vrais avis** (captures WhatsApp/Instagram fournies par Fouka, `context/import/banque contenue Sportvision/avis clients/`) — attribution par rôle/club, jamais le pseudo brut du client (vie privée), citations reformatées mais fidèles au sens original | Idéalement, remplacer l'attribution générique ("Parent d'un joueur") par un vrai nom + accord explicite si Fouka veut aller plus loin |
| Logos partenaires (barre de confiance) | **17/08/2026 : vrais logos intégrés** (RC Pays de Fontainebleau, FC Varenne Féminine, ASA Montereau, ES Colombienne, Elite Sports Camps Horizon, Roi du Béton, Alchimist Performance — `assets/partners/`) ; Games Factory/Brunoy FC/FC Milly-Gâtinais restent en texte seul (aucun logo fourni) | Fournir les logos manquants si disponibles ; confirmer l'accord de chaque structure pour figurer sur le site |
| Chiffres/statistiques | Volontairement absents (aucun "500 clubs accompagnés" inventé) — remplacés par une mention factuelle des zones d'intervention (Yonne, Seine-et-Marne, Île-de-France) | Ajouter de vrais chiffres dès qu'ils sont mesurés et validés |
| Galerie "Réalisations" | Déjà enrichie d'un vrai fond de 46+ photos/23 vidéos captées par SportVision (session antérieure) ; **17/08/2026 : +4 photos** (ASA Montereau, ES Colombienne montée R2, FC Varennes montée, tournoi international) + les 2 études de cas FC Varennes/ES Colombienne illustrées avec de vraies photos | Compléter si Fouka fournit d'autres visuels marquants (le dossier `gros projet realisé/` contient 114 fichiers au total, seule une sélection a été utilisée) |
| Mockups produit (hero, sections fonctionnalités) | Cartes stylisées reconstituant l'interface Connect, pas de vraies captures d'écran | Remplacer par de vraies captures une fois Connect testé et stabilisé |
| Icônes PWA / favicons du site | Favicon actuel = "S" généré en CSS/SVG simple | **17/08/2026 : un nouveau logo SportVision (icône stylisée + DA complète) a été fourni** par Fouka (`assets/brand/sportvision-logo-2026.png`, `assets/brand/DA-visuel-2026.png`) — **pas encore appliqué** : remplacerait le favicon ET le `.mark` du header sur TOUTES les pages du site (dizaines de fichiers), et la DA propose une palette légèrement différente (accent rose `#FF2CA3` absent de la charte actuelle) — décision de refonte visuelle à valider explicitement avec Fouka avant de toucher à tout le site |

## 4. Recommandations SEO

- Le fichier a déjà une balise `<title>` et `<meta description>` distinctes de Connect (qui est en `noindex`, volontairement — Connect ne doit jamais être indexé, c'est une zone privée).
- À ajouter avant mise en production : balises Open Graph (`og:title`, `og:image`, `og:description`) pour un partage propre sur réseaux sociaux, `sitemap.xml`, `robots.txt` (autoriser l'indexation ici, contrairement à Connect), données structurées Schema.org de type `Organization`/`LocalBusiness` pour le référencement local (cohérent avec le positionnement Yonne/Seine-et-Marne/Île-de-France).
- Chaque ancre de section (`#solutions`, `#offres`, `#realisations`...) peut devenir une vraie page dédiée plus tard sans casser les liens déjà partagés, si le référencement le justifie.
- Les images réelles (une fois fournies) devront avoir des attributs `alt` descriptifs — la structure actuelle n'a pas d'images réelles donc pas d'attributs à écrire pour l'instant.

## 5. Éléments à rendre administrables depuis SportVision OS

Pour que cette vitrine ne reste pas figée dans le code, les éléments suivants gagneraient à être pilotés depuis OS plutôt que codés en dur (non fait ici, cette page reste 100% statique pour l'instant) :
- Logos et chiffres de la barre de confiance.
- Galerie "Réalisations" (déjà un besoin identifié dans le cahier des charges d'origine : "administrable depuis OS ou un CMS simple").
- Témoignages.
- Études de cas.
- Offres et leur contenu (aujourd'hui dupliqué avec le catalogue interne d'OS — un seul endroit de vérité serait préférable).

C'est un chantier technique à part (probablement une table `site_vitrine_contenu` + une petite interface d'édition dans OS), pas fait dans cette livraison qui reste un site statique.

## 6. Pages secondaires — état et priorité

Le brief liste ~25 routes (§24). Seule la page d'accueil (`/`) est construite dans cette livraison. Priorité suggérée pour la suite, si tu veux que je continue :

**Haute priorité** (referencées par des CTA déjà présents sur la page d'accueil, actuellement redirigées en ancre `#` vers la home) :
- `/offres` — comparatif détaillé des 3 offres, avec plus de profondeur que les 3 cartes de la home.
- `/contact` ou `/demande-de-devis` — variante page complète du formulaire déjà modal sur la home.
- `/a-propos` — vision, équipe, zones d'intervention.
- `/mentions-legales`, `/confidentialite`, `/cgv` — pages légales, obligatoires avant toute mise en production réelle (actuellement des liens `#` vides dans le footer).

**Priorité moyenne** :
- `/solutions/clubs`, `/solutions/academies`, `/solutions/coachs`, `/solutions/joueurs` — versions détaillées des onglets déjà présents sur la home.
- `/services/*` — déclinaisons par service.
- `/realisations`, `/etudes-de-cas` — versions complètes de ce qui n'est qu'un aperçu sur la home.

**Basse priorité / dépend de fonctionnalités Connect pas encore construites** :
- `/club/[slug]`, `/evenement/[slug]`, `/galerie/[token]` — pages publiques dynamiques qui nécessitent que Connect expose des données publiques (aujourd'hui, tout ce qui existe côté Connect est derrière authentification). Chantier à part entière : décider quelles données un club/événement peut choisir de rendre publiques, ajouter les policies RLS de lecture anonyme correspondantes, avant même de penser au frontend.
- `/invitation/[token]`, `/mot-de-passe-oublie` — ces flux existent déjà côté Connect (`app/index.html` gère la connexion) mais pas comme pages autonomes sur le domaine vitrine.

## 7. Ce qui n'a volontairement pas été fait

- Pas de vraies photos/vidéos (aucune ne m'a été fournie) — remplacées par des placeholders visuels clairement identifiables comme tels dans le code (dégradés, pas d'images cassées).
- Pas de police auto-hébergée (chargée depuis Google Fonts avec `preconnect`) — à revoir pour la performance avant un vrai lancement si tu veux un score Lighthouse maximal.
- Pas de connexion à SportVision OS pour l'administration du contenu (§5 ci-dessus).
- Pas de pages secondaires au-delà de la home (§6 ci-dessus).
