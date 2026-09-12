# QA fonctionnelle transversale — boutons, liens, navigation (SportVision)

Campagne du 30/08/2026, une des 4 QA parallèles lancées après la refonte du site (cf. `SPORTVISION_SITE_FINAL_AUDIT.md`). Périmètre : balayage transversal bouton par bouton / lien par lien sur les **37 pages** de `livrables/SportVision/`, en dehors des scopes dédiés des 3 autres agents (tunnel de réservation + création de compte, Club+/Full Communication/Connect, recrutement/rétractation/cookies/légal).

Méthode : Chromium (Playwright 1.62, via `npx`), site servi en local (`python3 -m http.server`), desktop 1440×900 et mobile 390×844, clics/hover/touches clavier **réels** (`locator.click()`, `.hover()`, `page.keyboard.press()` — jamais `page.evaluate()` pour simuler une interaction ; `page.evaluate()` utilisé uniquement en lecture pour interroger le DOM après une vraie interaction, par ex. `classList.contains`).

---

## 1. Résumé exécutif

**Aucun bug fonctionnel trouvé dans ce périmètre.** Le site était déjà dans un état très propre suite à la campagne de refonte du même jour (5 agents, cf. `SPORTVISION_SITE_FINAL_AUDIT.md`) : 0 lien mort, 0 bouton sans action, 0 erreur console, 0 requête réseau en échec, 0 image cassée, 0 débordement horizontal, sur les 37 pages × 2 viewports (74 combinaisons). Plusieurs alertes soulevées par mes premiers scripts de test se sont révélées être des faux positifs de ma propre méthodologie (détaillés §6) — vérifiées puis écartées, pas des bugs du site.

**Aucun correctif appliqué** : rien de cassé trouvé à corriger. Ce rapport documente donc une vérification exhaustive plutôt qu'une liste de correctifs.

---

## 2. Tableau par page

Sur les 37 pages testées (desktop + mobile) : **0 lien mort, 0 bouton cassé, 0 erreur console, 0 débordement mobile** — colonnes identiques partout, résumées ci-dessous plutôt que répétées 37 fois.

| Page | Liens morts | Boutons cassés | Erreurs console | Débordement mobile |
|---|---|---|---|---|
| index.html | Aucun | Aucun | Aucune | Aucun |
| prestations.html | Aucun | Aucun | Aucune | Aucun |
| prestation-camera-isolee.html | Aucun | Aucun | Aucune | Aucun |
| prestation-coachs.html | Aucun | Aucun | Aucune | Aucun |
| prestation-creations.html | Aucun | Aucun | Aucune | Aucun |
| prestation-match-photo.html | Aucun | Aucun | Aucune | Aucun |
| prestation-match-video.html | Aucun | Aucun | Aucune | Aucun |
| prestation-media-day.html | Aucun | Aucun | Aucune | Aucun |
| prestation-montage-compilation.html | Aucun | Aucun | Aucune | Aucun |
| prestation-pack-match.html | Aucun | Aucun | Aucune | Aucun |
| prestation-shooting-equipe.html | Aucun | Aucun | Aucune | Aucun |
| prestation-shooting-joueur.html | Aucun | Aucun | Aucune | Aucun |
| prestation-tournois.html | Aucun | Aucun | Aucune | Aucun |
| full-communication.html | Aucun | Aucun | Aucune | Aucun |
| full-communication-academies.html | Aucun | Aucun | Aucune | Aucun |
| full-communication-clubs.html | Aucun | Aucun | Aucune | Aucun |
| full-communication-coachs.html | Aucun | Aucun | Aucune | Aucun |
| full-communication-evenements.html | Aucun | Aucun | Aucune | Aucun |
| club-plus.html | Aucun | Aucun | Aucune | Aucun |
| connect.html | Aucun | Aucun | Aucune | Aucun |
| accompagnements.html | Aucun | Aucun | Aucune | Aucun |
| accompagnements-academies.html | Aucun | Aucun | Aucune | Aucun |
| accompagnements-coachs.html | Aucun | Aucun | Aucune | Aucun |
| accompagnements-evenements.html | Aucun | Aucun | Aucune | Aucun |
| accompagnements-joueurs.html | Aucun | Aucun | Aucune | Aucun |
| realisations.html | Aucun | Aucun | Aucune | Aucun |
| a-propos.html | Aucun | Aucun | Aucune | Aucun |
| reserver.html | Aucun | Aucun | Aucune | Aucun |
| demande-de-devis.html | Aucun | Aucun | Aucune | Aucun |
| recrutement-community-manager.html | Aucun | Aucun | Aucune | Aucun |
| recrutement-photographe-videaste.html | Aucun | Aucun | Aucune | Aucun |
| cgv.html | Aucun | Aucun | Aucune | Aucun |
| mentions-legales.html | Aucun | Aucun | Aucune | Aucun |
| confidentialite.html | Aucun | Aucun | Aucune | Aucun |
| cookies.html | Aucun | Aucun | Aucune | Aucun |
| retractation.html | Aucun | Aucun | Aucune | Aucun |
| offres.html (redirection `noindex` vers `prestations.html`) | Aucun | Aucun | Aucune | Aucun |

*(37e page : `offres.html` n'est pas listée explicitement dans le mandat mais fait partie des 37 fichiers HTML du dossier — page de redirection pure, sans header/footer, testée quand même : redirection JS + `<meta http-equiv="refresh">` fonctionnelle, aucune erreur.)*

---

## 3. Détail des vérifications effectuées

### 3.1 Extraction statique des liens et assets (37 pages)
Script Node dédié parcourant chaque fichier HTML : tous les `href` (internes, ancres, externes, `mailto:`/`tel:`), tous les `src` d'images/vidéos/posters.
- **0 lien interne cassé** (fichier cible introuvable) sur les 37 pages.
- **0 ancre locale cassée** (`#id` sans élément correspondant).
- **0 asset manquant sur disque** (images/vidéos/posters).
- **5 liens externes uniques** trouvés sur tout le site, tous vérifiés vivants (code HTTP 200 ou redirection propre) : `connect.sportvision-an.fr`, `clubplus.sportvision-an.fr` (+ `/clubplus/signup-free`), `instagram.com/Sportvision_an`, `cm2c.net` (médiateur de la consommation, référencé en CGV).
- 46 occurrences de `href="#"` détectées automatiquement, **toutes vérifiées manuellement** : ce sont des déclencheurs JS légitimes (`id="cookie-manage"`, `data-action="open-devis"`, `id="ok-connect-link"`, `id="devis-connect-link"`), chacun avec un `addEventListener` confirmé dans le JS de la page. Aucun lien mort réel.

### 3.2 Sweep dynamique Playwright (37 pages × 2 viewports = 74 combinaisons)
Pour chaque page/viewport : navigation réelle, écoute `console` (erreurs), `pageerror`, `requestfailed` et réponses HTTP ≥ 400, mesure d'overflow horizontal (`scrollWidth` vs `clientWidth`), détection d'images cassées (`naturalWidth === 0` après chargement).
- **0 erreur console**, **0 erreur JS non catchée**, **0 requête réseau en échec (404/500)** sur les 74 combinaisons.
- **0px de débordement horizontal** sur les 74 combinaisons.
- 4 « images cassées » détectées automatiquement (sur `index.html` et `realisations.html`, desktop + mobile) — **faux positif vérifié** : il s'agit de `<img id="photo-img" src="">`, l'élément `<img>` vide du visualiseur photo en grand (lightbox), rempli dynamiquement en JS uniquement à l'ouverture d'une photo. Comportement normal, pas un bug.

### 3.3 Interactions réelles — navigation (36 pages, `offres.html` exclue car sans header)
Pour chaque page, desktop : hover réel sur les 3 déclencheurs de menu déroulant (« Prestations », « Solutions », « Mon espace »), vérification de la visibilité CSS réelle (`visibility`/`opacity` via `:hover`), clic réel sur un lien du sous-menu Prestations avec vérification de la destination, lecture du texte/`href` du CTA « Réserver une prestation » du header.
- **Dropdown « Prestations »** : visible au hover sur les 36 pages, clic réel sur « Match photo » → navigation confirmée vers `prestation-match-photo.html` sur les 36 pages.
- **Dropdown « Solutions »** : visible au hover sur les 36 pages.
- **Dropdown « Mon espace »** : visible au hover sur les 36 pages (vérifié aussi en re-test dédié après correction d'un faux positif de mon script, voir §6).
- **CTA header** : texte harmonisé « Réserver une prestation » partout, `href="reserver.html"` sur toutes les pages génériques ; sur les 10 fiches `prestation-*.html`, `href="reserver.html?besoin=<slug>"` — **comportement intentionnel confirmé** (paramètre lu par `reserver.html` via `URLSearchParams` pour présélectionner le besoin dans le tunnel), pas une incohérence.

Mobile (390×844), pour chaque page : clic réel sur le burger, vérification `aria-expanded`/ouverture du menu, clic réel sur l'accordéon « Prestations », vérification de l'ouverture (`<details open>`) et de la visibilité d'un sous-lien, touche **Échap** réelle → fermeture + focus rendu au burger, ré-ouverture puis clic réel sur un lien direct (« Réalisations ») → navigation confirmée et fermeture automatique du menu.
- **100 % des 36 pages** : burger ouvre/ferme correctement, accordéons s'ouvrent au clic réel, Échap ferme et restaure le focus, clic sur un lien direct navigue et referme le menu.

### 3.4 FAQ accordéons (27 pages avec `.faq-item`)
Clic réel sur le premier `.faq-q` de chaque page concernée, vérification `aria-expanded` + classe `.on`, puis re-clic pour vérifier la fermeture.
- **27/27 pages** : ouverture et fermeture correctes au clic réel (`a-propos`, les 4 variantes Accompagnements + page hub, `club-plus`, `connect`, `demande-de-devis`, les 4 variantes Full Communication + page hub, `index`, 10 fiches `prestation-*`, `prestations`, `realisations`).

### 3.5 Galerie Réalisations — filtres, pagination, modales, clavier
Test dédié, desktop et mobile, clics réels uniquement :
- **104 vignettes** au total, **14 visibles initialement** (plafond avant pagination).
- Bouton **« Voir plus »** : clic réel → les 104 vignettes deviennent visibles, le bouton se masque après clic. Fonctionnel.
- **Filtres** (clic réel sur chaque onglet) : Tout = 104, Football = 68, Basket = 3, Tennis = 16, Vidéo = 31 — comptages coherents et non nuls, filtrage fonctionnel.
- **Modale photo** : clic réel sur une vignette photo → ouverture confirmée (`classList.contains('on')`), image chargée (`src` non vide), fermeture réelle à la touche **Échap** confirmée.
- **Modale vidéo** : clic réel sur une vignette vidéo → ouverture confirmée, `src` du lecteur non vide, fermeture réelle au clic sur le bouton de fermeture confirmée.
- **Navigation clavier** : `Tab` vers une vignette (focus réel confirmé), touche **Entrée** → ouverture de la modale confirmée (le gestionnaire clavier du site déclenche `item.click()`, pas de piège au clavier).
- Reproduit à l'identique sur mobile (390×844) : filtre Tennis → 16 vignettes visibles, clic réel sur une vignette → modale ouverte. 0 erreur console pendant tout le test.

### 3.6 CTA « Parler à SportVision » / devis rapide (`data-action="open-devis"`, 27 pages concernées)
Clic réel sur le déclencheur de chaque page testée (échantillon représentatif : `index.html`, `prestation-match-photo.html`, `club-plus.html`, `accompagnements-academies.html`, `full-communication.html`, `prestation-creations.html`, `prestation-tournois.html`) + vérification de fermeture réelle.
- **7/7 pages testées** : modale de devis rapide (`#devis-overlay`) s'ouvre au clic réel et se ferme correctement au clic sur la croix. 0 erreur console.
- Sur `index.html`, le déclencheur est dans l'onglet caché « Je cherche un accompagnement » du hero (2 parcours à onglets) — **comportement normal**, vérifié en cliquant d'abord l'onglet (clic réel) puis le CTA : fonctionne.
- `prestations.html`, `connect.html`, `demande-de-devis.html` n'ont pas ce déclencheur rapide — normal, ces pages ont leurs propres CTA dédiés (cartes catalogue avec lien direct vers `reserver.html`, renvoi vers l'espace Connect, formulaire long déjà présent sur la page).
- **Vérification anti-copie-collé** : les 27 déclencheurs `data-action="open-devis"` répartis sur les variantes Accompagnements (×4) et Full Communication (×4) portent chacun un `data-devis-context` et/ou `data-devis-title` **distinct et correct par page** (ex. « Accompagnement Académie » vs « Accompagnement Coach / préparateur », « Full Communication — Clubs » vs « Full Communication — Tournois & événements »). Aucun contexte copié-collé d'une page à l'autre par erreur.

### 3.7 Intégrité du DOM
- **0 `id` dupliqué** dans aucune des 37 pages (vérifié programmatiquement).
- **0 artefact de développement** trouvé (`TODO`, `FIXME`, `Lorem ipsum`, `console.log`, gabarits `{{ }}` non résolus) sur les 37 pages.

---

## 4. Cohérence des prix — vérification transversale

Vérification croisée systématique entre trois sources indépendantes pour chaque prestation à prix fixe : le moteur de réservation (`reserver.html`, `data-price` — la source qui facture réellement), le catalogue (`prestations.html`), et la fiche dédiée (`prestation-*.html`, bloc `price-hero`).

**Résultat : 100 % cohérent, aucune correction nécessaire.**

| Prestation | `reserver.html` | `prestations.html` | Fiche dédiée |
|---|---|---|---|
| Match photo | 120 € TTC | 120 € TTC | 120 € TTC |
| Match vidéo | 120 € TTC | 120 € TTC | 120 € TTC |
| Pack Match Complet | 160 € TTC | 160 € TTC | 160 € TTC |
| Caméra isolée joueur | 150 € TTC | 150 € TTC | 150 € TTC |
| Montage & compilation | Dès 39,90 € HT | Dès 39,90 € HT | 39,90 € HT / 40-55-70-80 € HT |
| Match filmé drone | 120 € TTC | 120 € TTC | (option sur fiche Match vidéo) |
| Combo Drone + Photo | 160 € TTC | 160 € TTC | (option sur fiche Match photo) |
| Match filmé caméra Véo | 120 € TTC | 120 € TTC | (option sur fiche Match vidéo) |
| Combo Véo + Photo | 180 € TTC | 180 € TTC | (option sur fiche Match photo) |
| Shooting, Tournoi, Stage, Création, Coach, Media Day | Sur devis | Sur devis | Sur devis |

Point d'attention en cours de vérification, écarté après lecture complète du contexte : les fiches `prestation-camera-isolee.html` (150 € TTC en hero) et `prestation-match-video.html` (120 € TTC en hero) contiennent chacune une **carte de vente croisée** vers l'autre prestation, dans leur bon montant respectif (`prestation-camera-isolee.html` affiche « Match vidéo classique — 120 € TTC », `prestation-match-video.html` affiche « [Pack Match / upsell] — 160 € TTC »). Un premier grep isolé sur les nombres avait fait suspecter une inversion de prix entre les deux fiches ; la lecture du contexte complet confirme qu'il n'y a **aucune inversion réelle** — chaque fiche affiche bien son propre prix en hero et le bon prix des prestations tierces dans ses cartes de vente croisée.

**Hors périmètre, non vérifié en détail** : `club-plus.html` affiche des montants (0 €, 49 €, 59 €, 129 €, 139 €) relevant du scope Club+/Full Communication/Connect confié à un autre agent de cette campagne — simplement signalé ici pour information, aucune vérification croisée effectuée de mon côté.

---

## 5. Ce qui reste à traiter

**Rien dans mon périmètre.** Aucun bug fonctionnel trouvé sur la navigation, les CTA, les FAQ, la galerie Réalisations, les liens, ou la cohérence des prix catalogue/réservation/fiches.

Points de vigilance transmis pour information (hors de mon périmètre d'intervention) :
- Cohérence des tarifs Club+ (`club-plus.html` : 0 € / 49 € / 59 € / 129 € / 139 €) — à vérifier par l'agent en charge de Club+/Full Communication/Connect.
- Le rapport `SPORTVISION_SITE_FINAL_AUDIT.md` (campagne de refonte du même jour) documentait une dette mineure déjà connue et non bloquante (sauts de hiérarchie de titres `h1→h3`/`h2→h4` sur ~20 pages, `offres.html` avec canonical en chemin relatif) — non retestée ici car hors du périmètre « boutons/liens/navigation » de cette QA, toujours valable si Fouka souhaite la traiter.

---

## 6. Faux positifs rencontrés pendant cette QA (transparence méthodologique)

Trois alertes automatiques ont été soulevées puis **écartées après vérification manuelle** — aucune ne correspond à un bug réel du site :

1. **Dropdown « Mon espace » signalé invisible au hover sur les 36 pages** : bug dans mon propre script de test (`locator.isVisible()` levait une exception « strict mode violation » car mon sélecteur matchait 2 liens vers `connect.sportvision-an.fr` — le déclencheur lui-même et le lien du sous-menu — exception silencieusement avalée par un `.catch(() => false)`). Corrigé en ciblant le conteneur `.nav-dropdown` plutôt qu'un lien ambigu ; re-test sur les 36 pages : dropdown bien visible partout.
2. **CTA header avec `href` différent de `reserver.html` sur les 10 fiches prestation** : en réalité `reserver.html?besoin=<slug>`, un paramètre de contexte lu et exploité par `reserver.html` — comportement voulu, pas une incohérence.
3. **Inversion de prix suspectée entre `prestation-camera-isolee.html` et `prestation-match-video.html`** : un grep isolé sur les montants avait remonté un « 120 € » sur la fiche caméra isolée et un « 160 € » sur la fiche match vidéo ; la lecture du contexte complet (cartes de vente croisée) a confirmé l'absence de bug réel — voir §4.

---

## 7. Fichiers/scripts utilisés (non versionnés, hors du repo)

Scripts de test Playwright/Node écrits pour cette QA, exécutés depuis le scratchpad de session (hors du dépôt, non commités) :
- Extraction statique des liens/assets sur les 37 pages.
- Sweep dynamique (console/réseau/overflow/images) sur 37 pages × 2 viewports.
- Sweep d'interactions réelles (dropdowns, menu mobile, FAQ) sur 36 pages.
- Test dédié galerie Réalisations (filtres, pagination, modales, clavier).
- Test dédié modale de devis rapide sur 10 pages représentatives.
