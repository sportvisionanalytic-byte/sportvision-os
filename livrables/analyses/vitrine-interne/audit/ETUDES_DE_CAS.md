# Études de cas — `realisations.html`

Nouvelle section "Études de cas" ajoutée sur `realisations.html` (id `#etudes-de-cas`, entre la galerie et le CTA final) : 5 rangées alternées texte/mosaïque photo, chaque visuel cliquable (photo → modal plein écran, vidéo → lecteur modal), réutilisant les fonctions `openPhoto()`/`openVideo()` déjà en place pour la galerie de la page.

Aucun autre fichier n'a été modifié.

## Les 5 clients retenus

| # | Client | Pourquoi retenu |
|---|---|---|
| 1 | ASA Montereau | Matière réelle suffisante (3 photos + 1 vidéo), logo partenaire réel, déjà validé sur `index.html` |
| 2 | Elite Sport Camp Horizon | Matière la plus riche (4 photos + 1 vidéo drone), logo partenaire réel, déjà validé sur `index.html` et `accompagnements-evenements.html` |
| 3 | ES Colombienne | Matière riche (4 photos + 1 vidéo) **et** seul client du lot avec un vrai témoignage client exploitable (capitaine) |
| 4 | FC Varennes | Matière riche (4 photos + 1 vidéo), logo partenaire réel (FC Varenne Féminine) |
| 5 | Tournoi Sans Frontière (Sens) | Matière riche (4 photos + 1 vidéo), diversifie le portefeuille (tournoi international vs. clubs licenciés) |

## Clients écartés (prévus dans le brief mais sans matière réelle)

- **RC Pays de Fontainebleau (RCPF)** — seul un logo existe (`assets/partners/rc-fontainebleau.svg`). Aucune photo, aucune vidéo, aucun texte identifiable dans `assets/realisations/` ni dans le reste du site rattachable spécifiquement à ce club. Recherche menée : grep insensible à la casse sur "fontainebleau"/"rcpf" dans tous les `.html`/`.md` — seules 3 occurrences trouvées, toutes des placeholders de formulaire ("Ex. Fontainebleau"), aucune n'étant du contenu réel. Écarté conformément à la consigne "ne rien inventer".
- **Games Factory** — mentionné une seule fois, en texte seul, dans la barre de logos partenaires d'`index.html` (`<span class="logo-item">Games Factory</span>`) ; confirmé par `NOTES-VITRINE.md` comme n'ayant "aucun logo fourni". Aucune photo, aucune vidéo, aucun autre contexte texte trouvé nulle part dans le repo. Écarté pour la même raison.
- **FC Milly-Gâtinais** — candidat de repli envisagé (2 vidéos drone + 2 posters), mais écarté au profit de FC Varennes et du Tournoi Sans Frontière (Sens), qui disposent chacun de davantage de photos distinctes (4 vs. 2, toutes deux étant des posters de la même vidéo pour Milly) et sont déjà intégralement illustrés ailleurs sur le site (`accompagnements-evenements.html`, `index.html`) — la diversité de portefeuille était mieux servie en gardant Milly pour ces pages-là plutôt qu'en dupliquant.

Remplacement effectué conformément à la consigne du brief : "si tu ne trouves pas assez de matière réelle... remplace-le par un autre client de la liste des réalisations déjà présentes sur le site... qui a plus de matière réelle disponible."

## Sources utilisées, par client

Toutes les photos ci-dessous ont été **réellement ouvertes et regardées** avant rédaction des légendes/textes (aucune ne correspond au piège de nom de fichier trompeur signalé dans le brief, du type `celebration-portee.jpg` qui est en réalité un tir de basket — vérifié qu'aucune des 19 photos utilisées n'a ce problème).

### 1. ASA Montereau
- `assets/realisations/case-asa-montereau-03.jpg` (couverture) — célébration de but, effectif senior.
- `assets/realisations/asam-montereau-action-01.jpg`, `asam-montereau-action-02.jpg` — action de jeu.
- `assets/realisations/videos/reel-asam-montereau-01.mp4` (poster `reel-asam-montereau-01-poster.jpg`).
- Texte : titre "Un match capté au plus près de l'action" repris mot pour mot de la version déjà validée par le fondateur (`index.html`, corrigée le 18/08 selon `NOTES-VITRINE.md` — le "shooting collectif" initial n'avait jamais eu de photo correspondante, donc le texte a été corrigé plutôt que la photo inventée).
- Pas de témoignage client identifié pour ce club → bloc "Résultat/retour" volontairement omis (rien à afficher plutôt qu'inventer).

### 2. Elite Sport Camp Horizon
- `assets/realisations/case-elite-camp-horizon.jpg` (couverture) — briefing d'équipe en intérieur, stage.
- `case-elite-camp-horizon-02.jpg` (jonglage), `-03.jpg` (coach avec un jeune joueur), `-04.jpg` (groupe, pose de complicité).
- `assets/realisations/videos/reel-elite-camp-horizon-01.mp4` (poster `reel-elite-camp-horizon-01-poster.jpg`) — prise de vue aérienne drone.
- Texte : phrasés repris/adaptés de la version déjà validée (`index.html` + `accompagnements-evenements.html`).
- Pas de témoignage identifié → bloc "Résultat" omis.

### 3. ES Colombienne
- `assets/realisations/case-es-colombienne.jpg` (couverture) — joueur sous la pluie.
- `es-colombienne-montee-02.jpg` (célébration avec fumigène et tambour), `-03.jpg` (joueur n°7 sous la pluie), `-04.jpg` (célébration après match).
- `assets/realisations/videos/reel-es-colombienne-01.mp4` (poster `reel-es-colombienne-01-poster.jpg`).
- **Témoignage réel réutilisé** (déjà publié dans la section "Ce qu'en disent nos clients" d'`index.html`) : « Un vrai travail de patron. T'as tapé fort aujourd'hui ! » — attribué "Capitaine, ES Colombienne", même attribution que sur `index.html` (jamais de pseudo brut, conformément à la politique vie privée déjà en place sur le site).

### 4. FC Varennes
- `assets/realisations/case-fc-varenne.jpg` (couverture) — joueurs célébrant la montée.
- `fc-varenne-action-02.jpg` (portrait terrain), `-03.jpg` (supporters, banderole "FC VARENNES"), `-04.jpg` (supportrice, fumigène vert).
- `assets/realisations/videos/reel-fc-varenne-01.mp4` (poster `reel-fc-varenne-01-poster.jpg`).
- Texte : repris mot pour mot de la version déjà validée (`index.html`).
- Pas de témoignage identifié spécifiquement à ce club → bloc "Résultat" omis.

### 5. Tournoi Sans Frontière (Sens)
- `assets/realisations/tsf-tournoi-sens-01.jpg` (couverture) — jeune joueur, maillot Manchester United (tournoi international, clubs représentés en maillots pro).
- `tsf-tournoi-sens-02.jpg` (portrait, brassard TSF), `-03.jpg` (maillots PSG), `-04.jpg` (joueuse, maillot Toulouse FC rose).
- `assets/realisations/videos/reel-tsf-tournoi-sens-01.mp4` (poster `reel-tsf-tournoi-sens-01-poster.jpg`).
- Texte : repris mot pour mot de la version déjà validée (`index.html`).
- Pas de témoignage identifié → bloc "Résultat" omis.

## Choix éditorial : pas de "Résultat" inventé

Le brief autorise explicitement à omettre le résultat quand rien n'est disponible plutôt que d'en inventer un ("reste sur la description qualitative de ce qui a été réalisé"). Sur les 5 clients retenus, seule **ES Colombienne** dispose d'un vrai retour client exploitable — c'est le seul à afficher un bloc "Résultat/retour" (citation). Les 4 autres cartes s'arrêtent à Objectif + Réalisation, sans affirmation invérifiable du type "utilisé pour leurs réseaux sociaux" ou "clients très satisfaits".

## Vérifications techniques (Playwright)

Testé en 1440×900 (desktop) et 390×844 (mobile) :
- 0 image cassée (`naturalWidth` vérifié sur les 24 vignettes de la section — 5 couvertures + 19 photos/vidéos de la bande).
- 0 débordement horizontal (`scrollWidth` vs `clientWidth`).
- 0 erreur console.
- Clic sur une couverture → modal photo s'ouvre, image chargée.
- Clic sur une vignette vidéo → modal vidéo s'ouvre, bonne source assignée.
- Rangées alternées (image/texte, texte/image) en desktop ; empilement vertical propre en mobile.
