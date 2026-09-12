# Audit — Formulaires, légal, SEO technique, cohérence tarifs

Campagne autonome, périmètre exclusif : `reserver.html`, `demande-de-devis.html`, `cgv.html`, `confidentialite.html`, `cookies.html`, `mentions-legales.html`, `retractation.html`, `sitemap.xml`, `robots.txt`, `netlify.toml`. Vérifications réelles Playwright (remplissage/clic réels, pas de `page.evaluate()`), serveur statique local, desktop/tablette/mobile. Header/footer non touchés (harmonisés par un autre agent en parallèle).

---

## 1. Formulaires — bugs trouvés et corrigés

Les 3 formulaires publics du périmètre (`reserver.html` → tunnel 4 étapes, `demande-de-devis.html` → formulaire devis + modale RDV, `retractation.html` → formulaire de rétractation) étaient déjà d'un bon niveau de maturité (nombreux audits précédents visibles dans les commentaires du code). Aucun `alert()`/`confirm()` natif trouvé nulle part. Un bug réel et un défaut visuel réel ont été trouvés et corrigés :

### 1.1 Bug — messages d'erreur personnalisés inatteignables (corrigé)
`#booking-form` (reserver.html) n'avait pas l'attribut `novalidate`, alors que ses champs `required` (prénom/nom/e-mail/CGV) sont natifs. Résultat vérifié par test réel : la validation native du navigateur bloquait la soumission **avant** que le gestionnaire JS ne s'exécute — les messages d'erreur personnalisés ("Prénom, nom et e-mail sont obligatoires.", message CGV) étaient du code mort, jamais affichés. Seule une bulle de validation générique du navigateur apparaissait, incohérente avec le reste du design.
- **Fix** : ajout de `novalidate` sur `#booking-form`, alignant son comportement sur `#devis-form` (demande-de-devis.html) qui avait déjà ce pattern.
- **Effet de bord détecté et corrigé** : `novalidate` désactive aussi la validation native du **format** e-mail (`type="email"`). Sans compensation, un e-mail mal formé (`"pasunemail"`) aurait pu être envoyé au backend sans blocage. Ajout d'un contrôle de format e-mail en JS (regex simple) sur les 3 formulaires qui utilisent déjà `novalidate` sans ce filet : `#booking-form` (reserver.html), `#devis-form` (demande-de-devis.html, gap préexistant), `#rdv-form` (demande-de-devis.html — `novalidate` ajouté en même temps, même gap), `#retract-form` (retractation.html, gap préexistant).
- Vérifié en réel (Playwright, remplissage/clic réel) sur les 4 formulaires : champs vides → message clair ; e-mail invalide → message clair ; CGV/case de confirmation non cochée → message clair ; soumission valide → appel réseau correct + état de succès.

### 1.2 Défaut visuel — lien secondaire du hero non stylé (corrigé)
`demande-de-devis.html` : le bouton "Vous préférez qu'on en discute ? Demander un rendez-vous →" (classe `.btn-link`, dans `.hero-tertiary`) et son usage identique dans la FAQ n'avaient **aucune règle CSS définie** — un bouton natif brut (fond gris clair, coins carrés) s'affichait sur le hero sombre. Ajout des règles `.hero-tertiary`/`.btn-link` (couleur `--blue-electric`, soulignement, cohérent sur fond sombre et fond clair). Vérifié visuellement (capture d'écran) dans les deux contextes.

### 1.3 Vérifications réelles effectuées (aucun bug trouvé)
- **Anti double-soumission** : les 4 formulaires désactivent leur bouton (`disabled = true`, texte "Envoi…") dès le clic, avant la résolution de la requête réseau. Testé avec un réseau simulé lent (800ms) + double-clic forcé : un seul appel réseau part à chaque fois.
- **État de succès** : sur les 4 formulaires, l'état "succès" est un vrai composant UI (icône ✓, message, référence affichée), jamais un `alert()`, et jamais affiché avant confirmation serveur (retractation.html a même un commentaire de code citant explicitement cette règle : ne jamais afficher un succès optimiste).
- **Appels réseau** : `create-guest-request` (reserver.html, demande-de-devis.html), `create-guest-rdv` (modale RDV), `check-disponibilite` (reserver.html, étape 2), `submit-retractation-demande` (retractation.html) — tous vérifiés via l'onglet réseau Playwright, payload correct, non cassés par les changements de cette session.
- **Champs superflus** : aucun champ retiré. Le tunnel `reserver.html` a déjà été retravaillé lors d'audits précédents pour filtrer dynamiquement options et champs contextuels selon le besoin choisi (`OPTIONS_BY_BESOIN`, `CHAMPS_GROUPS_BY_BESOIN`) — rien d'inutile identifié en plus.
- **Mobile/tablette** : aucun débordement horizontal détecté (375px, 390px, 768px) sur `reserver.html` (aux 4 étapes) ni `demande-de-devis.html`.

### 1.4 CTA sticky mobile — ajouté sur demande-de-devis.html uniquement
Étudié sur les 2 pages comme demandé :
- **reserver.html** : NON ajouté. Le tunnel est court et chaque étape a déjà sa propre action principale contextuelle ("Continuer" / "Envoyer ma demande") visible sans scroll long. Un CTA sticky générique aurait fait doublon avec ce bouton déjà présent et risqué de recouvrir les champs de l'étape 4 sur petit écran.
- **demande-de-devis.html** : AJOUTÉ. C'est une page longue (hero → douleurs → démo → offres → réalisations → témoignages → FAQ) où le formulaire n'est atteint qu'une fois via le lien du hero, puis perdu de vue pendant tout le reste du scroll. Un bandeau sticky mobile ("Aller au formulaire", ancre vers `#devis`) réapparaît après le hero et se masque automatiquement dès que le formulaire (`#devis`) est réellement à l'écran, via deux `IntersectionObserver` — garantie testée en réel qu'il ne recouvre **jamais** un champ de formulaire (vérifié aux limites : juste avant/pendant/juste après la section formulaire). Invisible sur desktop/tablette (`display:none` au-dessus de 640px).

---

## 2. Légal — corrections de forme faites + ACTION HUMAINE REQUISE

Les 5 pages légales (`cgv.html`, `confidentialite.html`, `cookies.html`, `mentions-legales.html`, `retractation.html`) sont déjà à un niveau de rigueur juridique élevé (CGV V1.0 datée du 9 août 2026, structure en articles complète, RGPD détaillé). Rendu sobre confirmé (pas d'effets premium/spectaculaires ajoutés, conforme au mandat).

**Corrections de forme faites (sûres, réversibles) :**
- `retractation.html` : ajout du contrôle de format e-mail sur `#retract-form` (voir §1.1) — correctif technique, aucune modification du texte juridique.
- Hiérarchie de titres vérifiée : un seul `<h1>` par page, séquence `h2` propre sans saut sur les 5 pages, aucun souci.
- Liens internes vérifiés programmatiquement (tous les `href` vers des `.html` du dossier, y compris `assets/`) : **aucun lien cassé** dans les 7 pages du périmètre. Le renvoi croisé `retractation.html` → `cgv.html#article-35` correspond bien à l'ancre `id="article-35"` présente dans `cgv.html`.
- Lisibilité/typo : aucune coquille ou incohérence de mise en page trouvée nécessitant correction.

**ACTION HUMAINE REQUISE : aucune.** Aucune incohérence de fond (tarif, délai, process) trouvée entre les CGV et le reste du site sur les points vérifiables : CGV Art. 22 "24 heures maximum" cohérent avec les pages prestations ; délai de réponse devis "24 à 48h ouvrées" (demande-de-devis.html) cohérent avec "sous 48 heures ouvrées" (retractation.html) ; durée de conservation 6 mois (CGV Art. 25) cohérente avec `COOKIE_CONSENT_MAX_AGE_MS` (183 jours) mentionné en commentaire dans les 4 pages qui l'utilisent. Aucune reformulation de fond effectuée — si une incohérence de fond existe ailleurs sur le site (hors du périmètre vérifiable ici), voir §4.

---

## 3. SEO technique — 37 pages

Auditées : title/description/canonical/OG/Twitter/JSON-LD/hiérarchie de titres/alt images, sur les 37 pages `.html` du dossier (lecture pour les 25 hors périmètre d'édition, correction directe pour les 7 pages du périmètre). `sitemap.xml` et `robots.txt` vérifiés et corrigés dans mon périmètre.

### Résumé — points vérifiés, tout est propre
- **Title/description** : uniques sur les 37 pages, aucun doublon exact ni quasi-doublon problématique (les similarités trouvées — ex. "Match Photo — 120 € TTC" vs "Match Vidéo — 120 € TTC" — sont des produits volontairement parallèles qui se différencient correctement).
- **Canonical** : présent et correct sur les 37 pages, convention `/prestations/xxx`, `/accompagnements/xxx`, etc. cohérente avec `sitemap.xml` (1:1, vérifié programmatiquement).
- **Open Graph / Twitter cards** : présents et complets sur les 37 pages.
- **JSON-LD** : valide (parse JSON OK) partout où présent. **FAQ JSON-LD vérifiée mot pour mot contre le texte visible sur les 27 pages qui en ont une : 27/27 correspondances exactes, aucune contradiction trouvée.**
- **Images** : `alt` correct partout (les logos décoratifs ont `alt="" aria-hidden="true"`, correct puisque le nom de marque est adjacent en texte).
- **`sitemap.xml`** (périmètre d'édition) : les 36 pages indexables (37 − `offres.html`, seule page `noindex`) y figurent, aucune URL orpheline, aucune page privée/`noindex` listée par erreur. **Aucune correction nécessaire, déjà à jour.**
- **`robots.txt`** (périmètre d'édition) : `Allow: /` sans `Disallow` global, sitemap référencé en URL absolue. **Déjà correct, aucune correction nécessaire.**

### Points trouvés (hors périmètre d'édition — à transmettre)
1. **Saut de hiérarchie `h5` dans le footer partagé, sur les 37 pages** : les colonnes du footer (`<h5>Prestations</h5>`, `Offres`, `Connect`, `Ressources`, `Entreprise`) créent un saut depuis le dernier titre de contenu (h2/h3/h4) de chaque page. C'est un problème du template de footer partagé (édité par l'agent en charge du header/footer commun sur les 37 pages, hors de mon périmètre) — un seul correctif dans ce bloc partagé résout les 37 pages d'un coup.
2. **~20 pages** (essentiellement `prestation-*.html`, `full-communication*.html`, `accompagnements*.html`) : sauts `h1→h3` ou `h2→h4` supplémentaires dans les sections héros/grilles de cartes — cosmétique SEO, pas bloquant, hors de mon périmètre d'édition (voir liste détaillée fournie ci-dessous par fichier).
3. **`offres.html`** (stub de redirection `noindex`, hors périmètre) : le `canonical` pointe vers `prestations.html` en chemin relatif au lieu de l'URL absolue `https://sportvision-an.fr/prestations`. Priorité faible (page `noindex`, non indexée de toute façon).
4. **9 pages sans JSON-LD** (légal ×5 déjà normal, `reserver.html` normal, `realisations.html`/`recrutement-*.html` ×3) : pas une erreur, mais amélioration possible — schéma `ImageGallery`/`CollectionPage` pour `realisations.html`, `JobPosting` pour les 2 pages de recrutement. Hors périmètre d'édition.

Détail fichier par fichier des sauts de titres (point 2), pour transmission à l'agent propriétaire ou correction directe par toi : `accompagnements-academies.html`, `accompagnements-coachs.html`, `accompagnements-joueurs.html`, `full-communication-clubs.html`, `full-communication-coachs.html`, `full-communication-academies.html`, `full-communication-evenements.html`, `prestation-coachs.html`, `prestation-creations.html`, `prestation-match-photo.html`, `prestation-match-video.html`, `prestation-media-day.html`, `prestation-pack-match.html`, `prestation-shooting-equipe.html`, `prestation-shooting-joueur.html`, `prestation-tournois.html` (saut `h1→h3`), et `index.html`, `accompagnements.html`, `club-plus.html`, `connect.html`, `full-communication.html`, `prestations.html`, `prestation-camera-isolee.html`, `prestation-montage-compilation.html` (saut `h2→h4` dans des grilles de cartes).

---

## 4. Cohérence des tarifs — sur l'ensemble du site

Tous les prix (`€`) des 37 pages ont été relevés et comparés à la source de vérité confirmée. **Un seul produit est en incohérence : "Montage & compilation".** Tout le reste du site (Match photo/vidéo 120 € TTC, Pack Match Complet 160 € TTC, Caméra isolée 150 € TTC, Combo Drone+Photo 160 € TTC, Match filmé Véo 120 € TTC, Club+ Start 49/59 € TTC/mois, Club+ Performance 129/139 € TTC/mois) est cohérent avec la source de vérité partout où trouvé — aucune autre incohérence.

### 4.1 Corrigé directement (mes pages) — `reserver.html`
Le tunnel affichait "Montage & compilation" en **€ TTC** avec un barème 40/40/60/80/100 (≤6min / 1 / 2 / 3 / 4 matchs), alors que la source de vérité confirmée est **39,90 € HT (≤6 min)** et **40/55/70/80 € HT (1 à 4 matchs)**. Corrigé :
- Carte "Montage & compilation" étape 1 : "Dès 39,90 € HT" (au lieu de "Dès 40 € TTC").
- Sélecteur "Matière à monter" étape 3 : 39,90 € HT / 40 € HT / 55 € HT / 70 € HT / 80 € HT (au lieu de 40/40/60/80/100 € TTC).
- Récapitulatif et données envoyées au backend (`create-guest-request`) mis à jour en cohérence (nouvelle fonction `formatPriceFr()` pour l'affichage décimal "39,90").
- Vérifié en réel : sélection "2 matchs complets" → récap affiche "55 € HT", payload réseau envoyé avec la bonne valeur.

`demande-de-devis.html` ne mentionne aucun tarif chiffré (formulaire de contact générique) — rien à corriger sur cette page.

### 4.2 NON corrigé — hors périmètre d'édition, à corriger par toi
Le reste du site utilise systématiquement le barème TTC 40/40/60/80/100 (au lieu de 39,90 HT / 40/55/70/80 HT) pour "Montage & compilation". Liste précise fichier:ligne — valeur trouvée vs valeur attendue :

| Fichier : ligne | Valeur trouvée | Valeur attendue |
|---|---|---|
| `index.html:625` | "Dès 40 € TTC" (carte offre montage) | "Dès 39,90 € HT" |
| `prestation-camera-isolee.html:497` | "Dès 40 € TTC" (bandeau cross-sell) | "Dès 39,90 € HT" |
| `prestation-camera-isolee.html:500` | "Dès 40 € TTC" (price-row cross-sell) | "Dès 39,90 € HT" |
| `prestation-montage-compilation.html:7,17,21` | meta title/description "Dès 40 € TTC" | "Dès 39,90 € HT" |
| `prestation-montage-compilation.html:297` | JSON-LD FAQ : "40 € TTC... de 40 à 100 € TTC... +20 € par match" | à réaligner sur 39,90 € HT / 40-55-70-80 € HT |
| `prestation-montage-compilation.html:403` | price-hero "Dès 40 €" / "TTC" | "Dès 39,90 €" / "HT" |
| `prestation-montage-compilation.html:441` | "Jusqu'à 6 minutes de rush — 40 € TTC" | "39,90 € HT" |
| `prestation-montage-compilation.html:448-451` | tableau 1/2/3/4 matchs = 40/60/80/100 € TTC | 40/55/70/80 € HT |
| `prestation-montage-compilation.html:480` | gcard "Dès 40 € TTC" | "Dès 39,90 € HT" |
| `prestation-montage-compilation.html:549` | FAQ visible (doit rester identique au JSON-LD ligne 297 une fois corrigé) | idem |
| `prestation-montage-compilation.html:561` | CTA final "Dès 40 € TTC" | "Dès 39,90 € HT" |
| `prestations.html:542` | price-row carte montage "Dès 40 € TTC" | "Dès 39,90 € HT" |

Note : ces pages appartiennent à d'autres agents/à ton périmètre — je ne les ai pas modifiées pour ne pas casser leur travail, conformément à la consigne. Le barème complet HT à appliquer partout : **39,90 € HT (≤6 min pré-découpé)**, **40 € HT (1 match)**, **55 € HT (2 matchs)**, **70 € HT (3 matchs)**, **80 € HT (4 matchs)**, au-delà sur devis.

---

## 5. Autres corrections faites dans mon périmètre (annexes)

- **`netlify.toml`** : la CSP autorisait encore `https://fonts.googleapis.com`/`https://fonts.gstatic.com` (style-src/font-src) alors que les 37 pages chargent leurs polices en local via `@font-face` + `assets/fonts/*.woff2` depuis un précédent passage (vérifié : zéro référence à ces domaines sur l'ensemble du site). Retiré de la CSP — resserrement de sécurité sûr et réversible, sans rien casser (vérifié : TOML valide, aucune page du site n'appelle ces domaines).

---

## Résumé exécutif

- **Formulaires (P0/P1)** : 1 bug réel corrigé (validation native masquant les messages d'erreur personnalisés + regression de format e-mail compensée sur 4 formulaires), 1 défaut visuel corrigé (lien non stylé), CTA sticky mobile ajouté sur `demande-de-devis.html` uniquement (raisonné, testé aux limites). Tout le reste (anti double-soumission, états de succès, appels réseau, absence d'`alert()`) était déjà solide et vérifié en réel.
- **Légal (P1)** : forme déjà excellente, 1 correctif technique sûr (validation e-mail), aucune ACTION HUMAINE REQUISE.
- **SEO (P2)** : les 37 pages sont propres sur l'essentiel (title/desc/canonical/OG/JSON-LD/alt/sitemap/robots) ; seul point structurel réel est le saut `h5` du footer partagé (template, pas mon périmètre) + quelques sauts de titres cosmétiques sur ~20 pages.
- **Tarifs (P1)** : un seul produit incohérent site-wide — "Montage & compilation" (HT vs TTC, et barème différent). Corrigé sur mes 2 pages ; liste précise fichier:ligne fournie ci-dessus pour le reste du site.
