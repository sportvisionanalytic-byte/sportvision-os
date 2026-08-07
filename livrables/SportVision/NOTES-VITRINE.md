# Vitrine publique SportVision — Notes de livraison

Complète `index.html`. Couvre les points du brief qui ne sont pas du code : analyse des références, contenu à fournir, SEO, administration, pages restantes.

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
| Témoignages (section "Ce qu'en disent nos clients") | Textes plausibles, non attribués à une personne réelle, mention "en cours de collecte" ajoutée sous la section | Remplacer par de vrais témoignages avec accord de la personne, ou retirer la section |
| Logos partenaires (barre de confiance) | Texte seul (FC Fontainebleau, Varenne, Elite Sport Camp, Games Factory), pas de vrais logos | Fournir les logos réels + accord de chaque structure pour figurer sur le site |
| Chiffres/statistiques | Volontairement absents (aucun "500 clubs accompagnés" inventé) — remplacés par une mention factuelle des zones d'intervention (Yonne, Seine-et-Marne, Île-de-France) | Ajouter de vrais chiffres dès qu'ils sont mesurés et validés |
| Galerie "Réalisations" | Cadres colorés en dégradé (aucune vraie photo/vidéo disponible) | Remplacer par de vrais visuels SportVision, format WebP/AVIF compressé |
| Mockups produit (hero, sections fonctionnalités) | Cartes stylisées reconstituant l'interface Connect, pas de vraies captures d'écran | Remplacer par de vraies captures une fois Connect testé et stabilisé |
| Icônes PWA / favicons du site | Aucune | À créer, cohérentes avec celles déjà prévues pour Connect |

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
