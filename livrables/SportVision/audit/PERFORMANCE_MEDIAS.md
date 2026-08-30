# Audit performance médias — SportVision (site vitrine statique)

Date : 30/08/2026
Périmètre : `livrables/SportVision/*.html` + `livrables/SportVision/assets/`
Outils utilisés : `cwebp 1.6.0` (-q 82), ImageMagick `identify`, Playwright (Chromium) pour vérification visuelle avant/après.

---

## 1. Conversion WebP

**108 images converties** (toutes les images JPG référencées par un `<img>` dans le HTML, dans `assets/realisations/` et `assets/equipe/`) :

| Dossier | Images converties | Poids avant | Poids après | Gain |
|---|---|---|---|---|
| `assets/realisations/` | 104 | 21.11 Mo | 9.39 Mo | **11.72 Mo (-55%)** |
| `assets/equipe/` | 4 | 1.68 Mo | 0.81 Mo | **0.87 Mo (-52%)** |
| **Total** | **108** | **22.79 Mo** | **10.20 Mo** | **12.59 Mo (-55%)** |

- Conversion `cwebp -q 82`, best-effort AVIF non tenté (pas d'`avifenc` disponible dans l'environnement, conforme aux consignes).
- **Aucune image n'a produit un WebP plus lourd que l'original** — aucun fallback à documenter, les 108 conversions sont toutes gagnantes.
- Chaque `<img>` concerné a été enveloppé dans une balise `<picture>` avec `<source type="image/webp">` + fallback `<img src=".jpg">`, exactement selon le pattern demandé :
  ```html
  <picture>
    <source srcset="assets/realisations/xxx.webp" type="image/webp">
    <img src="assets/realisations/xxx.jpg" alt="…" loading="lazy" width="…" height="…">
  </picture>
  ```
- **217 balises `<img>` transformées** sur **21 fichiers HTML** (toutes les occurrences de ces 108 images, y compris quand la même photo apparaît sur plusieurs pages — ex. hero `index.html`, galerie `realisations.html`, fiches `prestation-*.html`) :

| Fichier | `<picture>` créées |
|---|---|
| `realisations.html` | 104 (galerie complète, photos + vignettes vidéo) |
| `index.html` | 27 (hero, galerie « Que faisons-nous », études de cas) |
| `a-propos.html` | 10 (équipe) |
| `prestations.html` | 15 |
| `recrutement-photographe-videaste.html` | 6 |
| `accompagnements-academies.html` / `-coachs.html` | 4 chacun |
| `accompagnements-evenements.html` | 2 |
| `accompagnements-joueurs.html` | 3 |
| `recrutement-community-manager.html` | 2 |
| 11 fiches `prestation-*.html` (galeries « Exemples ») | 1 à 4 chacune |

**Note sur la galerie « études de cas » d'`index.html`** : les miniatures ouvertes dans la lightbox (générées dynamiquement en JS à partir des attributs `data-src`) n'ont **pas** été converties en WebP — elles ne sont chargées qu'à l'ouverture d'un clic utilisateur (aucun impact LCP/poids initial de page), et le faire proprement aurait nécessité une détection de support WebP côté JS pour rester robuste sans `<picture>`. Laissé en l'état, documenté ici comme piste d'amélioration future plutôt que patché à la hâte.

**Non touchés délibérément** : `assets/brand/*.png` (logos), `assets/partners/*` (logos partenaires, SVG/PNG/JPEG déjà légers), `assets/og-image.jpg` (utilisé uniquement en meta og:image, doit rester une URL JPG statique unique). Conversion webp jugée non rentable/risquée pour ces logos (petits fichiers, formats variés, gain marginal).

---

## 2. `width`/`height` explicites (anti-CLS)

- **217 `<img>`** (galeries realisations/equipe) ont reçu `width`/`height` réels, lus via `identify` sur le fichier source — jamais de valeur inventée.
- **85 `<img>`** supplémentaires ont reçu `width`/`height` : le logo `assets/brand/logo-mark.png` (header + footer, 36 fichiers HTML du site) et les 7 logos partenaires du bandeau de confiance (`index.html` + `recrutement-community-manager.html`).
- Total : **302 attributs `width`/`height` ajoutés**, 0 valeur devinée.
- Avant l'audit, **aucune image du site n'avait de `width`/`height`** — confirmé par un scan exhaustif de tous les fichiers HTML avant intervention.

---

## 3. Vidéos

- **Un seul lecteur en autoplay** sur tout le site : le hero `index.html` (`#hero-video`). Il était déjà correctement gaté (nuit précédente) par `prefers-reduced-motion` + `matchMedia('(min-width: 1024px)')` avant tout `.play()` — vérifié, rien à corriger.
- **4 autres `<video>`** sur le site (modales de lecture dans `index.html`, `realisations.html`, `prestation-camera-isolee.html`, `prestation-montage-compilation.html`) : aucune n'a d'attribut `autoplay`, aucune n'a de `src` avant ouverture par clic utilisateur (`openVideo()` / `videoModalPlayer.play()` déclenchés uniquement au clic). Comportement déjà sûr.
- Ajout explicite de `preload="none"` sur ces 4 lecteurs modaux (ils n'avaient pas d'attribut `preload`, ce qui laissait le comportement par défaut du navigateur ambigu). Objectif : zéro octet vidéo téléchargé tant que l'utilisateur n'a pas cliqué.
- **Posters vérifiés** : 30 fichiers `*-poster.jpg` dans `assets/realisations/`, tous de vraies captures dédiées (100-140 Ko, dimensions cohérentes avec le format vertical/horizontal de la vidéo), pas de premier-frame par défaut. Rien à corriger — ces posters sont d'ailleurs les mêmes fichiers `<img>` utilisés comme vignettes de galerie, donc déjà passés en WebP + `<picture>` avec le reste du lot.

---

## 4. `prefers-reduced-motion`

Audit exhaustif sur les 36 fichiers HTML : chaque page qui définit des animations/transitions CSS (`@keyframes`, `animation:`, `transition:`) contient la règle globale suivante (déjà en place avant cette session, vérifiée présente partout où elle est nécessaire) :

```css
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important;scroll-behavior:auto !important}
}
```

Cette règle utilise un sélecteur universel (`*`) qui neutralise **toutes** les animations/transitions de la page (reveal au scroll, hover, transitions de section comprises), pas seulement la vidéo hero. Couverture confirmée à 100% : les 34 fichiers ayant des animations ont tous la règle ; les 2 fichiers sans animation (`offres.html` notamment) n'en ont pas besoin. **Aucune correction nécessaire sur ce point.**

---

## 5. Priorité de chargement (`index.html`)

- Le hero vidéo (`#hero-video`) a reçu `fetchpriority="high"` (déjà `preload="none"`, mais le `poster` doit être chargé en priorité puisque c'est souvent l'élément LCP réel sur mobile, la vidéo elle-même ne se chargeant qu'à ≥1024px).
- Les 3 images `hero-reel-tile` (tennis/basket/portrait) affichées juste à côté de la vidéo dans le mockup avaient `loading="lazy"` alors qu'elles font partie du bloc hero visible immédiatement (juste sous la ligne de flottaison sur la plupart des viewports, chargées en même temps que le reste du hero) — **`loading="lazy"` retiré** sur ces 3 images.
- Vérifié qu'aucune autre image « above the fold » du site ne portait `loading="lazy"` à tort (galeries et fiches prestations commencent toutes sous un bloc de texte, donc `loading="lazy"` y est correct et conservé).

---

## 6. Vérification visuelle (Playwright)

Captures desktop (1440×900) et mobile (390×844) sur `index.html`, `realisations.html`, `prestation-match-video.html`, `prestation-montage-compilation.html` :
- **Aucune image cassée** (`naturalWidth === 0`) détectée sur les 8 combinaisons page/viewport.
- **Aucune requête réseau en échec**, aucune erreur JS console.
- Inspection visuelle : rendu WebP net, pas de dégradation perceptible par rapport aux JPG originaux (qualité 82 suffisante pour du contenu photo sportif).
- `<picture>` ne casse pas les CSS existantes (`position:absolute` + `object-fit:cover` sur les `img` de galerie, `width:100%;height:100%` sur les covers d'études de cas) : tous les sélecteurs CSS du site ciblent `img` en descendant (`.gallery-item img`, `.hero-reel-tile img`, `.team-photo img`), pas en enfant direct, donc l'ajout du wrapper `<picture>` (display inline, sans dimension propre) est transparent.

---

## Résumé chiffré

- **108 images JPG converties en WebP**, 0 échec, 0 régression de poids.
- **12,59 Mo économisés** sur le poids des médias transférables (avant 22,79 Mo → après 10,20 Mo, soit -55%), sur les images effectivement servies au navigateur (le JPG original reste sur disque en fallback, servi seulement aux navigateurs sans support WebP).
- **217 balises `<picture>`** créées sur **21 fichiers HTML**.
- **302 attributs `width`/`height`** ajoutés (217 galerie + 85 logos), tous basés sur les dimensions réelles des fichiers.
- **4 lecteurs vidéo modaux** passés en `preload="none"` explicite.
- **1 hero vidéo** passé en `fetchpriority="high"`.
- **3 images hero** repassées en chargement immédiat (retrait de `loading="lazy"`).
- `prefers-reduced-motion` : couverture déjà complète, aucune correction nécessaire.
- Postes vidéo : déjà tous présents et légers, aucune correction nécessaire.

## Ce qui n'a pas été touché (hors scope ou jugé non prioritaire)

- Logos `assets/brand/*.png` et `assets/partners/*` : pas de conversion WebP (gain marginal, risque de complexité pour peu de Ko).
- Miniatures de la lightbox « études de cas » d'`index.html` (générées en JS depuis `data-src`) : pas de WebP, chargées uniquement après clic utilisateur donc hors chemin critique.
- `assets/realisations/videos/*.mp4` (183 Mo, 27 fichiers) : aucune compression/ré-encodage tenté — hors scope de cette mission (ni `ffmpeg` demandé, ni consigne de retravailler l'encodage vidéo). Les vidéos ne sont de toute façon jamais préchargées (voir §3).
