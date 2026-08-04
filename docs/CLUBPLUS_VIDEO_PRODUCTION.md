# Production des vidéos de démonstration — SportVision Club+

Pipeline pour produire les vidéos d'interface de la landing page publique de Club+ : Playwright enregistre de vrais parcours dans `app.html` (mode démonstration, données fictives, aucun appel réseau), FFmpeg encode les exports finaux.

**État à la date de ce document** : prototypes **Coach** et **Hero** produits et vérifiés (captures ci-dessous). Les 6 autres vidéos (Community Manager, Sponsors, Joueur & Famille, Prestation, Overview) ne sont pas encore produites — cf. §7.

---

## 1. Outils utilisés

| Outil | Statut au démarrage | Action |
|---|---|---|
| Node.js / npm | déjà présents (v26.5.0 / 11.17.0) | — |
| Playwright | absent | installé en dépendance locale de `scripts/product-videos` (`npm install`), pas globalement |
| Chromium (Playwright) | absent | `npx playwright install chromium` (télécharge le binaire dans `~/Library/Caches/ms-playwright`) |
| FFmpeg | absent | installé via `brew install ffmpeg` (build complet : libx264, libx265, libvpx, libopus...) |
| webp / cwebp | absent | installé via `brew install webp` — le FFmpeg d'Homebrew n'embarque pas l'encodeur `libwebp`, les posters passent donc par une étape PNG intermédiaire (`ffmpeg` → PNG) puis `cwebp` (PNG → WebP) |

L'enregistrement vidéo lui-même utilise le **context recording natif de Playwright** (`browser.newContext({ recordVideo })`), pas un outil de capture d'écran séparé : Playwright screencaste la page directement en `.webm`.

## 2. Comptes / accès utilisés

**Aucun compte réel, aucun accès réseau.** `app.html` a un vrai mode démonstration (`doDemoLogin(role)`) qui bascule l'app sur un jeu de données 100 % en mémoire (`DATA`), sans jamais appeler Supabase. Les scripts se contentent de :

1. Ouvrir `app.html` en local (`file://.../livrables/SportVision-Club-Plus/app.html`).
2. Injecter la persona de cette campagne (`lib/demo-persona.js`, exécuté via `page.evaluate()`) — mute les objets `ROLES`/`DATA` déjà déclarés par l'app (ils sont `const`, jamais réassignés, seulement leurs propriétés) pour remplacer les identités de démo par défaut par celles demandées : FC Clairval, équipes Seniors R1/U18 R2/U15/U13/Féminines, Marc Lefèvre (président), Sarah Martin (secrétaire), Lina Robert (CM), Thomas Bernard (coach U18 R2), Julien Morel (sponsors), sponsors Nova Énergie/BatiPro/Horizon Automobile.
3. Cliquer sur un rôle de la grille de connexion démo (`doDemoLogin`), ou changer de rôle en cours d'enregistrement via le sélecteur `#roleSel` (`onRoleChange`) — c'est ce qui permet de filmer plusieurs personas dans un seul enregistrement continu pour la vidéo Hero.

**Espace Joueur & Parent : non couvert par le mode démonstration.** `app.html` n'active ces espaces que derrière une vraie session Supabase authentifiée (`REAL.space==='joueur'|'parent'`, cf. phases 6/7 du module Joueur & Famille) — `doDemoLogin` ne les couvre pas. Créer un compte réel pour filmer aurait écrit dans la base de production, ce que la mission interdit explicitement. Impact documenté §6/§7.

## 3. Structure des dossiers

```
scripts/product-videos/          # scripts Playwright (Node, dépendances locales)
  package.json
  lib/
    demo-persona.js              # override DATA/ROLES en mémoire (aucune écriture disque/réseau)
    record-utils.js              # launchDemoPage, naturalClick, naturalFill, pause...
  record-coach-result.js
  record-hero.js

public/videos/clubplus/
  raw/                           # sorties brutes Playwright (.webm), jamais publiées telles quelles
  hero/                          # exports finaux de la vidéo hero
  features/                      # exports finaux des vidéos de fonctionnalité (coach, CM, sponsors...)
  overview/                      # export final de la vidéo générale (à produire, §7)
  posters/                       # .webp, une image par vidéo
```

## 4. Parcours enregistrés (prototypes)

### Coach — `record-coach-result.js`
Mobile (430×932). Connexion démo *Coach U18* (persona Thomas Bernard) → menu *Plus* → *Match Center* → onglet *À venir* (match U18 R2 vs US Fontainebleau visible) → *Résultat express* → Équipe U18 R2 / Domicile / adversaire *US Fontainebleau* / score *3-1* → *Envoyer* → onglet *Reçus* (carte avec le score, confirmation visuelle).

**Écart assumé** : la mission demandait une étape "ajouter une photo". Le formulaire *Résultat express* réel de Club+ n'a pas ce champ (seulement équipe / domicile-extérieur / adversaire / score) — l'étape est omise plutôt que simulée avec un élément qui n'existe pas dans le produit. Décision produit à prendre : ajouter réellement ce champ à `app.html`, ou confirmer que l'étape doit rester hors du script vidéo.

### Hero — `record-hero.js`
Desktop (1920×1080), un seul enregistrement continu qui change de rôle en cours de route (`#roleSel`) :
Président (Marc Lefèvre) → tableau de bord → **Coach** (Thomas Bernard) → Match Center → *Résultat express* U18 R2 vs US Fontainebleau 3-1 → *Envoyer* → onglet Reçus → ouverture du match → *Envoyer à la Newsroom* → **Community Manager** (Lina Robert) → Newsroom, l'information apparaît (badge *Reçu*) → ouverture → *Transformer en publication* → Studio de création, onglet *À valider* → **Président** → Studio de création → ouverture du visuel → *Valider* (confirmation) → **Community Manager** → Banque média (galerie).

**Écarts assumés** (détail §6) :
- "Coach sur mobile" filmé sur le même viewport desktop que le reste (pas de changement de viewport en cours d'enregistrement — le vrai clip mobile existe séparément, cf. `coach-result-mobile-raw.webm`, composable en incrustation lors d'un montage humain).
- "Galerie disponible dans l'Espace Joueur" remplacé par la Banque média (dirigeants) — l'Espace Joueur n'est pas accessible en mode démonstration (§2).

## 5. Commandes d'enregistrement

```bash
cd scripts/product-videos
npm install                      # une seule fois
npx playwright install chromium  # une seule fois

npm run record:coach             # -> public/videos/clubplus/raw/coach-result-mobile-raw.webm
npm run record:hero              # -> public/videos/clubplus/raw/hero-desktop-raw.webm
```

Règles appliquées pendant l'enregistrement (mission §3) : navigateur Chromium headless fraîchement lancé à chaque script (pas de profil persistant, aucune extension, aucune notification système possible en headless), `page.fill()` plutôt que la frappe caractère par caractère pour les champs (évite un rendu haché), un `hover()` avant chaque clic pour un mouvement de curseur réaliste, des pauses courtes (200-1400 ms) calibrées action par action plutôt qu'une attente réseau (il n'y en a pas, tout est en mémoire). `deviceScaleFactor`/`isMobile`/`hasTouch` réglés selon le device pour un rendu responsive réel, pas un desktop réduit.

## 6. Décisions produit à valider avant d'aller plus loin

1. **Formulaire Résultat express sans champ photo** (coach) — ajouter le champ réellement, ou retirer l'étape du script définitivement ?
2. **Espace Joueur/Parent non démontrable sans vraie session** — trois options : (a) laisser la vidéo Hero se terminer sur la Banque média (dirigeants) comme actuellement, (b) créer un compte de test dans un projet Supabase de **staging séparé** (si vous en créez un — le projet actuel est le seul, partagé en production avec OS/Portail), (c) construire un mode démonstration dédié à l'Espace Joueur/Parent dans `app.html` (changement de produit, hors périmètre de cette mission vidéo).
3. **Incrustation mobile dans le Hero** — le clip `coach-result-mobile-raw.webm` peut être composé en incrustation (picture-in-picture) dans le Hero desktop lors d'un montage plus poussé ; pas fait pour ce prototype (simple juxtaposition/alternance serait le prochain pas, avant un vrai compositing).

## 7. Reste à produire (après validation des deux prototypes)

- `coach-result-desktop.mp4` (même script, `device:'desktop'`)
- `clubplus-hero-mobile.mp4` (même script `record-hero.js`, `device:'mobile'` — le script est déjà paramétrable, pas testé à ce jour)
- Community Manager, Sponsors, Joueur & Famille, Prestation SportVision (nouveaux scripts, même patron que `record-hero.js`)
- Overview (assemblage FFmpeg des meilleurs extraits des autres vidéos, cf. mission §10)

## 8. Commandes FFmpeg (pipeline post-production)

Le brut Playwright (`raw/*.webm`, codec VP8) n'est jamais publié tel quel. Trois étapes, dans cet ordre :

### a) Vidéo MP4 (H.264, avec fondus discrets d'entrée/sortie)

```bash
# Mobile : recadrage 430×932 -> export vertical 1080×1920 (letterbox couleur marque #050F20)
ffmpeg -y -i raw/coach-result-mobile-raw.webm \
  -vf "scale=886:1920:flags=lanczos,pad=1080:1920:(1080-886)/2:0:color=0x050F20,fade=t=in:st=0:d=0.25,fade=t=out:st=9.9:d=0.3" \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 21 -preset slow -movflags +faststart \
  features/coach-result-mobile.mp4

# Desktop : léger accéléré pour tenir la durée cible (ici 22.76s bruts -> 18s), fondus, sans audio
ffmpeg -y -i raw/hero-desktop-raw.webm \
  -vf "setpts=PTS/1.2644,fade=t=in:st=0:d=0.35,fade=t=out:st=17.6:d=0.4" \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart \
  hero/clubplus-hero-desktop.mp4
```

Le facteur `setpts=PTS/<facteur>` se calcule à partir de la durée brute réelle (`ffprobe -v error -show_entries format=duration -of csv=p=0 fichier.webm`) et de la durée cible : `facteur = durée_brute / durée_cible`.

### b) Version WebM (VP9), ré-encodée depuis le MP4 déjà traité (mêmes fondus/recadrage, un seul filtrage)

```bash
ffmpeg -y -i features/coach-result-mobile.mp4 -c:v libvpx-vp9 -b:v 0 -crf 34 -an features/coach-result.webm
ffmpeg -y -i hero/clubplus-hero-desktop.mp4  -c:v libvpx-vp9 -b:v 0 -crf 30 -an hero/clubplus-hero-desktop.webm
```

### c) Poster WebP (image fixe, <250 Ko)

```bash
# 1) une frame PNG (le FFmpeg Homebrew n'a pas l'encodeur libwebp)
ffmpeg -y -i features/coach-result-mobile.mp4 -ss 00:00:00.4 -frames:v 1 posters/coach-result-poster.png
# 2) conversion en WebP via cwebp (package `webp`)
cwebp -q 82 posters/coach-result-poster.png -o posters/coach-result-poster.webp
rm posters/coach-result-poster.png
```

### Résultats obtenus (prototypes)

| Fichier | Résolution | Durée | Poids | Cible mission |
|---|---|---|---|---|
| `features/coach-result-mobile.mp4` | 1080×1920 | 10,2 s | 926 Ko | 3-6 Mo ✅ (bien en dessous) |
| `features/coach-result.webm` | 1080×1920 | 10,2 s | 524 Ko | — |
| `posters/coach-result-poster.webp` | — | — | 62 Ko | < 250 Ko ✅ |
| `hero/clubplus-hero-desktop.mp4` | 1920×1080 | 18,0 s | 1,39 Mo | 4-8 Mo ✅ (bien en dessous) |
| `hero/clubplus-hero-desktop.webm` | 1920×1080 | 18,0 s | 1,23 Mo | — |
| `posters/clubplus-hero-poster.webp` | — | — | 51 Ko | < 250 Ko ✅ |

Tous les exports sont nettement sous les budgets de poids fixés par la mission — la qualité (`-crf`) peut être resserrée (valeurs plus basses) sans risquer de dépasser les objectifs si le rendu doit être encore affiné visuellement.

## 9. Refaire une vidéo après une modification de l'interface

1. Vérifier que le sélecteur/texte utilisé dans le script (`record-*.js`) correspond toujours à l'élément réel dans `app.html` (les scripts ciblent des `data-id`, des classes stables, ou du texte exact — pas de sélecteurs CSS fragiles générés automatiquement).
2. Relancer le script concerné (`npm run record:coach` ou `record:hero`) — écrase le fichier `raw/*-raw.webm` correspondant.
3. Rejouer les commandes FFmpeg de post-production (§8) — recalculer le facteur `setpts` si la durée brute a changé.
4. Vérifier visuellement (extraire quelques frames avec `ffmpeg -ss ... -frames:v 1 sortie.png`) avant de remplacer le fichier publié.

## 10. Intégration au site — pas encore faite

Volontairement laissée de côté à ce stade (validation des deux prototypes d'abord, comme demandé). Point d'attention pour cette étape : la landing page (`livrables/SportVision-Club-Plus/SportVision-Club-Plus.html`) référence déjà des chemins `assets/video/<clé>.mp4|webm` relatifs au dossier publié par Netlify (`livrables/SportVision-Club-Plus/`), alors que cette mission produit les fichiers sous `public/videos/clubplus/` à la racine du repo. Il faudra soit copier les exports finaux dans `livrables/SportVision-Club-Plus/assets/video/`, soit adapter les chemins de la landing page — à trancher au moment de l'intégration, pas avant.
