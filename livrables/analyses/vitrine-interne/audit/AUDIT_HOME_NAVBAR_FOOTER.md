# Audit + refonte — Home, Navbar, Footer (SportVision)

Périmètre : `index.html` (priorité absolue) + header/footer sur les 37 pages HTML de `livrables/SportVision/` + design tokens (`:root`). Travail effectué dans le worktree isolé `agent-a2c97e87ceae57dd2`, commits locaux uniquement, aucun push.

Vérification réelle effectuée avec Playwright (Chromium, via `npx playwright`, interactions réelles — clics, hover, touches clavier, pas de `page.evaluate()` pour les tests d'interaction) sur `index.html` servi en local (`python3 -m http.server`), aux trois tailles demandées : desktop 1440×900, tablette 768×1024, mobile 390×844. Spot-check identique (overflow, dropdown, menu mobile, footer) sur 5 autres pages patchées (`club-plus.html`, `cgv.html`, `realisations.html`, `reserver.html`, `a-propos.html`) pour confirmer la propagation.

---

## 1. Constat de départ

Le design system existant (palette noir/bleu nuit/bleu électrique/cyan/violet, `Manrope`/`Inter`, boutons, cards, radius, shadows) était déjà solide et conforme au mandat — je l'ai conservé et renforcé plutôt que remplacé, comme demandé. Le problème principal n'était pas la palette mais deux choses :

1. **Le hero n'utilisait aucun média réel.** Il combinait un texte (bon) et un mockup 100 % abstrait — un faux dashboard "Connect" avec des cartes stylisées (`gcard`), sans aucune photo ni vidéo issue de `assets/realisations/`. C'est exactement le type de "template SaaS générique" que le mandat interdit, alors que le site dispose d'un vrai fond de 100+ photos et 30+ vidéos de captations réelles.
2. **Le header/footer était dupliqué à l'identique sur 36 pages** avec quelques micro-incohérences (texte du CTA "Réserver" vs "Réserver une prestation" selon les pages, icône Instagram en texte brut "IG", accessibilité clavier partielle des menus déroulants).

## 2. Problèmes trouvés, classés par priorité

### P0 — Bloquant / expérience cassée
- **Cookie banner par-dessus le menu mobile.** `z-index` : `.cookie-banner` = 2500, `.mobile-nav` = 999. Résultat vérifié en interaction réelle avec Playwright : quand le menu mobile est ouvert et que le bandeau cookies est encore affiché (premier passage d'un visiteur), le bandeau intercepte les clics sur les liens du bas du menu (`locator.click` a timeout sur le lien "Réalisations", bloqué par `<div id="cookie-banner">` selon le message Playwright `subtree intercepts pointer events`). Sur mobile/tablette c'est le scénario le plus courant (premier visiteur = bandeau cookies encore visible). **Corrigé** sur les 36 pages.

### P1 — Majeur (contredit le mandat produit)
- **Hero sans aucun média réel** (voir §1.1). Le hero est explicitement la priorité #1 du mandat ("Hero beaucoup plus impressionnant... sport + image + performance + production + communication + technologie perçus en quelques secondes"). **Corrigé** sur `index.html`.
- **CTA header incohérent** : sur `index.html`, le bouton desktop du header disait "Réserver" alors que la version mobile de la même page, et le header de presque toutes les 35 autres pages, disaient "Réserver une prestation". **Corrigé.**

### P2 — Notable
- **Sous-menu "Prestations" sur une seule colonne** (11 liens empilés verticalement) — lisible mais long et un peu austère pour un menu qui doit représenter le cœur du catalogue. Le mandat demandait explicitement de vérifier sa lisibilité vu le nombre d'entrées. **Corrigé** : passage en grille 2 colonnes (`nav-dropdown-wide`) sur les 36 pages.
- **Accessibilité clavier des sous-menus incomplète** : pas de `aria-expanded`/`aria-haspopup` sur les triggers de dropdown (Prestations, Solutions, Mon espace), pas de fermeture au clavier (Échap) du menu mobile. **Corrigé.**
- **Icône Instagram en texte brut "IG"** dans le footer — fonctionnel mais visuellement peu premium pour une marque qui se positionne média/tech. **Corrigé** (icône SVG).
- **Footer visuellement plat** — un bloc gris/navy uni sans signature visuelle propre à la marque, alors que le hero et les CTA finaux ont un vrai traitement lumineux (glow, gradient). **Corrigé** (liseré dégradé en haut + glow radial discret, cohérent avec le hero).

### P3 — Mineur
- Portes d'entrée secondaires (Club+, Full Communication, Réalisations) absentes du hero lui-même — elles existent bien plus bas sur la page ("Trois solutions"), mais pas "en quelques secondes" comme le souhaite le mandat. **Corrigé** par une ligne de liens discrète sous les CTA du hero, sans toucher à l'architecture de conversion (onglets "prestation"/"accompagnement") qui reflète une décision produit déjà tranchée par le fondateur le 2026-08-06 (commentaire dans le code : "rééquilibrage v4").
- `.mobile-nav` de la plupart des pages n'avait pas `overflow-y:auto` (seul `reserver.html` l'avait) — un menu mobile avec beaucoup d'entrées sur un très petit écran pouvait déborder verticalement sans scroll. **Corrigé** sur les 36 pages en même temps que le fix de z-index.
- `reserver.html` a un déséquilibre `<div>`/`</div>` (149 ouvrants / 148 fermants) — **préexistant**, vérifié via `git show HEAD:...` avant mes modifications, donc hors de mon fait. Je ne l'ai pas corrigé car il est dans le `<body>` de `reserver.html`, hors de mon périmètre (header/footer uniquement) — à signaler à l'agent qui possède cette page.

---

## 3. Corrections appliquées — détail

### 3.1 Hero (`index.html` uniquement)

**Avant :** bloc `.app-frame` façon "fenêtre d'app" contenant un `.app-grid` de 4 cartes stylisées 100 % fictives ("Ma prestation : Pack Match Complet", "Devis : Accepté et signé", "Médiathèque : 238 contenus"...). Aucune image, aucune vidéo. Deux `.float-card` (mockup UI) en overlay.

**Après :** le même cadre "fenêtre d'app" (bordure, barre à 3 points, ombre — qui donne le signal "produit/tech") contient maintenant une **grille de 4 tuiles de médias réels** (`hero-reel-strip`) façon bande de rushs :
- 1 vidéo réelle (`reel-match-action-01.mp4`, action de match, lecture en boucle silencieuse) avec icône lecture,
- 3 vraies photos de captations (tennis, basket, portrait joueur) — sport, angles et disciplines variés.

Sous la bande de médias, 2 puces "verre" (`gcard`) reprennent des **faits déjà vérifiés ailleurs sur le site** (aucun chiffre inventé) : "Livraison — Sous 24h maximum" (repris de `prestations.html`) et "Prestations — Dès 120 € TTC" (repris du `hero-micro` existant).

**Détail technique important — une itération a été nécessaire.** Le premier essai plaçait la vidéo en plein cadre large (ratio ~2,47:1, comme l'ancien mockup). Or les vidéos de la médiathèque sont au format portrait 9:16 (720×1280, format "reel" vertical). En `object-fit:cover` dans un cadre aussi large, la vidéo se retrouvait extrêmement zoomée et recadrée sur une fine bande horizontale du milieu de l'image — vérifié à l'écran avec Playwright, le rendu montrait un immeuble en arrière-plan du terrain plutôt que l'action de jeu. **Corrigé** en repensant la mise en page : 4 tuiles au ratio 3:4 (recadrage beaucoup plus doux, ~25 % de la hauteur perdue au lieu de ~90 %), disposées en bande façon "bibliothèque de contenus" — qui, en plus de résoudre le recadrage, renforce le signal "média" du positionnement SportVision.

**Chargement de la vidéo :** elle ne se charge et ne joue que sur viewport ≥ 1024px et si `prefers-reduced-motion` n'est pas actif (vérifié en JS, pas seulement en CSS, car l'attribut `autoplay` HTML ignore cette préférence). En dessous de ce seuil (tablette, mobile) ou avec réduction de mouvement activée, seule l'affiche (`poster`, une vraie photo déjà sélectionnée) s'affiche — pas de téléchargement vidéo inutile sur mobile, pas de mouvement imposé aux visiteurs qui l'ont refusé.

**Portes d'entrée du hero :** ajout d'une ligne discrète sous les CTA principaux : *"Autres portes d'entrée : Club+ · Full Communication · Voir nos réalisations"*. Les CTA primaires du hero (architecture à onglets "Je veux une prestation" / "Je cherche un accompagnement") n'ont pas été modifiés — c'est une décision produit déjà actée par le fondateur (voir commentaire dans le code, "rééquilibrage v4", 2026-08-06) qui priorise la conversion immédiate ; je ne suis pas revenu dessus, j'ai seulement complété la couverture des autres portes d'entrée du mandat sans la perturber.

**Header CTA :** "Réserver" → "Réserver une prestation" (alignement avec le reste du site).

### 3.2 Navbar (36 pages)

- Sous-menu "Prestations" (11 entrées) passé en grille 2 colonnes (`nav-dropdown-wide`, 460px de large), avec le lien "Toutes les prestations →" qui s'étend sur les deux colonnes en pied de menu. Le sous-menu "Solutions" (7 entrées) reste en 1 colonne, sa hauteur restant raisonnable.
- Accessibilité clavier des menus déroulants desktop (Prestations, Solutions, Mon espace) : `aria-haspopup="true"` et `aria-expanded` synchronisés en JS sur hover **et** sur focus clavier (`focusin`/`focusout`), pas seulement en CSS `:hover`/`:focus-within`.
- Menu mobile : `aria-expanded` sur le bouton burger, fermeture au clavier avec **Échap** (testée en conditions réelles : ouverture → Échap → fermeture confirmée, focus rendu au bouton burger), `overflow-y:auto` uniformisé.
- **Fix P0** : `z-index` du menu mobile relevé de 999 à 2600 (au-dessus du bandeau cookies à 2500) pour qu'un menu ouvert ne soit jamais bloqué par le bandeau cookies encore affiché en dessous.

### 3.3 Footer (36 pages)

- Icône Instagram : texte brut "IG" → icône SVG (même style que les icônes déjà utilisées ailleurs sur le site — trait, pas de remplissage), avec micro-interaction au survol (fond plus clair, légère translation verticale).
- Signature visuelle : liseré dégradé (bleu → cyan → violet, très fin, 1px) en haut du footer + glow radial discret centré, cohérent avec le traitement déjà utilisé dans le hero et le CTA final (`--grad-hero-glow`) — sans surcharge, un seul effet lumineux à la fois comme demandé par le mandat.
- Contenu du footer (navigation, colonnes, mentions légales) **non modifié** — déjà complet et correctement structuré.

### 3.4 Design tokens (`:root`)

Audit effectué : les tokens (`--navy-900`, `--blue`, `--cyan`, `--violet-bright`, `--grad-brand`, `--radius`, `--shadow-lg`, polices...) étaient **déjà parfaitement synchronisés** entre `index.html` et les 34 autres pages qui ont un hero (vérifié caractère près, 795 caractères identiques dans chaque `:root`). Les pages légales/utilitaires (`cgv.html`, `confidentialite.html`, `cookies.html`, `mentions-legales.html`, `retractation.html`, les 2 pages recrutement) ont un `:root` plus court (513 caractères) car elles n'ont pas de hero — c'est normal, pas une incohérence. **Aucune correction nécessaire ici**, le travail avait déjà été bien fait par une session précédente.

---

## 4. Vérification réelle (Playwright)

Résultats sur `index.html`, aux 3 tailles demandées, avec captures d'écran et interactions réelles (pas `page.evaluate()`) :

| Test | Desktop 1440×900 | Tablette 768×1024 | Mobile 390×844 |
|---|---|---|---|
| Overflow horizontal | 0px | 0px | 0px |
| Erreurs console | Aucune | Aucune | Aucune |
| Hero lisible/impactant | ✅ | ✅ | ✅ |
| Dropdown "Prestations" (hover réel) | ✅ visible, 460px, 2 colonnes | — | — |
| Menu mobile (clic réel sur burger) | — | ✅ ouvre, `aria-expanded=true` | ✅ ouvre |
| Accordéon mobile "Prestations" (clic réel) | — | ✅ sous-liens visibles | ✅ sous-liens visibles |
| Fermeture au clavier (Échap, touche réelle) | — | ✅ | ✅ |
| Fermeture par clic sur un lien | — | ✅ | ✅ |
| CTA "Réserver" → bon lien | `reserver.html` ✅ | `reserver.html` ✅ | `reserver.html` ✅ |
| Footer complet, icône IG en SVG | ✅ | ✅ | ✅ |

Spot-check identique (overflow, dropdown desktop, menu mobile + Échap, icône IG, glow footer) sur `club-plus.html`, `cgv.html`, `realisations.html`, `reserver.html`, `a-propos.html` : **0 problème détecté** aux deux tailles testées (desktop/mobile).

---

## 5. Changements UI/UX marquants — avant/après

**Hero (bloc visuel produit).**
- *Avant :* fenêtre d'app avec un dashboard 100 % fictif ("Devis accepté et signé", "238 contenus"...), aucune photo ni vidéo réelle.
- *Après :* même fenêtre d'app, mais elle montre désormais une bande de 4 vrais médias SportVision (vidéo de match + 3 photos multi-sports), avec deux puces de faits vérifiés (délai 24h, tarif dès 120€). Le produit "Connect" reste illustré juste en dessous, dans sa propre section dédiée (`feature-row`), inchangée.

**Header (36 pages).**
- *Avant :* CTA "Réserver" incohérent entre desktop/mobile sur la home ; sous-menu Prestations en liste verticale de 11 liens ; pas d'`aria-expanded` ; menu mobile sans fermeture clavier ; menu mobile passant sous le bandeau cookies.
- *Après :* CTA harmonisé partout ; sous-menu Prestations en 2 colonnes ; navigation clavier complète (Tab, Échap) ; menu mobile toujours au-dessus du bandeau cookies.

**Footer (36 pages).**
- *Avant :* bloc uni, icône Instagram en texte "IG".
- *Après :* liseré dégradé + glow discret en signature de marque, icône Instagram en SVG avec micro-interaction au survol.

---

## 6. ACTION HUMAINE REQUISE

Aucune décision business bloquante rencontrée pendant cette campagne (pas de tarif, pas de suppression d'offre, pas de témoignage à valider). Un seul point à signaler pour transparence, non bloquant :

> **Direction créative du hero, à confirmer si besoin.** `NOTES-VITRINE.md` (§2, "Analyse des références") contient une note plus ancienne du fondateur indiquant une préférence pour un hero qui "montre déjà un mockup de l'interface, pas seulement une photo sportive". Le mandat de cette campagne va dans le sens inverse (médias réels, pas de mockup abstrait façon SaaS). J'ai tranché en faveur du mandat de campagne, le plus récent et le plus explicite, en gardant un compromis : le cadre "fenêtre d'app" (signal produit/tech) est conservé, mais son contenu est maintenant fait de vrais médias plutôt que de cartes fictives. Si ce choix ne convient pas, il est isolé dans un seul bloc HTML/CSS (`hero-reel-strip` dans `index.html`) et facile à ajuster.

Point technique à signaler à l'agent propriétaire de `reserver.html` (hors de mon périmètre) : déséquilibre préexistant de balises `<div>` dans le `<body>` de cette page (149 ouvrantes / 148 fermantes), confirmé antérieur à cette campagne via `git show HEAD:...`.

---

## 7. Fichiers modifiés

- `livrables/SportVision/index.html` — hero (médias réels + JS de lecture conditionnelle), header (CTA), footer (icône + glow), nav-dropdown 2 colonnes, a11y clavier, fix z-index menu mobile.
- 35 autres pages HTML du dossier (toutes sauf `offres.html`, une simple redirection sans header) — mêmes corrections header/footer/nav propagées via script Python idempotent, vérifié champ par champ (comptage avant/après) plutôt que remplacement de bloc entier, pour éviter tout risque sur les micro-variations légitimes déjà présentes (état "actif" du menu, libellés spécifiques à certaines pages).
- `livrables/SportVision/audit/AUDIT_HOME_NAVBAR_FOOTER.md` — ce rapport.

Aucun fichier hors de ce périmètre (`assets/`, contenu du `<body>` des pages autres que header/footer) n'a été modifié.
