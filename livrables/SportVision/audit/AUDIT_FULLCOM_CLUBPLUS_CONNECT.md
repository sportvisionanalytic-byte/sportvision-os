# Audit + refonte premium — Full Communication / Club+ / Connect / Accompagnements

Périmètre : `full-communication.html` + 4 variantes (clubs/coachs/académies/événements), `club-plus.html`, `connect.html`, `accompagnements.html` + 4 variantes (académies/coachs/événements/joueurs). Header/footer non touchés (agent parallèle dédié). Reconstitué par l'orchestrateur à partir des comptes-rendus de fin de mission (l'agent d'origine ne l'avait pas rédigé lui-même) — contenu fidèle aux changements réellement mergés sur `main`.

---

## 1. Problème principal trouvé et corrigé

Les 4 pages Full Communication (générique + variantes clubs/coachs/académies) affirmaient : « certains clients valident chaque publication, d'autres pré-valident un calendrier mensuel » comme fonctionnement standard. C'est inexact vis-à-vis du produit réel : le Community Manager SportVision publie **en autonomie**, sans validation client obligatoire avant chaque publication — la validation « interne » n'existe qu'entre un CM Junior et son tuteur, jamais présentée comme une validation client.

Corrigé sur les 4 pages : paragraphe « Vous gardez la visibilité, pas la charge », item de liste, FAQ visible **et** son JSON-LD structured data (`Est-ce que je perds la main sur ce qui est publié ?`). `connect.html` avait la même formulation dans sa propre FAQ (« validations » au lieu de « visibilité complète sur les publications ») — repérée et alignée au passage, hors du grep initial de l'orchestrateur.

## 2. Corrections produit vérifiées (déjà correctes, confirmées intactes)

- **Club+ vs Connect** : séparation des rôles déjà correcte sur le site (Club+ = espace professionnel des clubs/académies/coachs, Connect = espace personnel joueurs/parents/agents) — vérifiée après la campagne, aucune dérive introduite.
- **Club+ inclus dans Full Communication sans coût supplémentaire** : déjà correct, confirmé intact.
- **Tarifs Club+ Start/Performance** (49/59 € et 129/139 €/mois) : cohérents avec l'OS interne, non modifiés.

## 3. Corrections UI/UX appliquées

- **Full Communication (page générique)** : nouvelle section « Le cycle qui tourne chaque semaine » — Planning → Terrain → Production → Création → Publication → Performance, remplace une simple liste à puces par une frise visuelle en 6 étapes (`cycle-strip`), casse la monotonie titre/texte/liste.
- **Club+** : la section « Un espace adapté à chaque rôle » (Administrateur, Coach, Communication, Directeur sportif, Secrétaire/Administratif, Trésorier) est passée d'une simple liste de tags à des cartes bénéfices (`accomp-grid-5`/`accomp-card`), avec pour chaque rôle une phrase concrète sur ce qu'il voit dans Club+ — répond directement à la question du mandat « pourquoi un club paierait pour Club+ ? ».
- **CTA** : ajout d'un CTA rendez-vous cohérent sur les 3 variantes clubs/coachs/académies (« Une question avant de vous lancer ? Demander un rendez-vous → »), harmonisé avec `connect.html`.
- **Sémantique** : liste de la frise de production passée en `<ol>` (liste ordonnée), plus correct qu'une `<ul>` pour une séquence d'étapes.

## 4. Accompagnements (5 pages) — suite de mission

- **`accompagnements.html`** (hub) et **`accompagnements-coachs.html`** : déjà conformes, aucun changement nécessaire.
- **`accompagnements-academies.html`** : lien FAQ « Peut-on aussi déléguer la publication… » pointait vers `full-communication.html` générique au lieu de la variante dédiée `full-communication-academies.html` — corrigé pour cohérence avec le pattern déjà appliqué sur la page coachs.
- **`accompagnements-evenements.html`** : la page reposait uniquement sur des grilles d'icônes et une seule photo réelle (hero). Ajout d'une section « Études de cas » avec 2 cas 100 % réels déjà validés ailleurs sur le site (Elite Sport Camp Horizon, FC Milly-Gâtinais), textes repris à l'identique d'`index.html` pour ne rien inventer.
- **`accompagnements-joueurs.html`** : page la plus mince du lot (2 sections seulement). Ajout d'une section « Tous les sports » (football/tennis/basketball). Une 4e image initialement prévue (`celebration-portee.jpg`, légendée « Émotion / Célébration ») a été retirée après vérification visuelle directe : il s'agissait en réalité d'un tir en suspension au basketball, pas une célébration — écarté plutôt que publier une légende inexacte.
- Un même piège de spécificité CSS (`style="grid-template-columns"` inline écrasant les media queries responsive) a été trouvé et corrigé sur les deux nouvelles sections (événements et joueurs), avec des classes dédiées (`.case-grid-2`, `.gallery-grid-3`).

## 5. Vérification réelle

Playwright (Chromium), serveur statique local, clics réels — pas de `page.evaluate()`. Sur les 12 pages du périmètre final (5 Full Communication + Club+ + Connect + 5 Accompagnements), desktop 1440×900 / tablette 768×1024 / mobile 390×844 : 0 erreur console, 0 débordement horizontal, modales devis/RDV fonctionnelles sur les pages qui en disposent (RDV non applicable sur le hub Accompagnements, normal). Un faux-positif d'images « cassées » sur mobile (artefact de timing du script de test avec le lazy-loading) a été identifié et écarté par un second script de vérification dédié (HTTP 200, `naturalWidth` correct sur les 3 breakpoints).

## 6. AVANT / APRÈS

| Page | Avant | Après |
|---|---|---|
| Full Communication (×4) | « certains clients valident chaque publication » présenté comme fonctionnement standard | CM autonome, visibilité complète et temps réel via Club+, cycle de production en 6 étapes visualisé |
| Club+ | Rôles en simple liste de tags | Rôles en 6 cartes bénéfices concrètes |
| Accompagnements Événements | Grilles d'icônes seules, 1 photo | + section Études de cas (2 cas réels) |
| Accompagnements Joueurs | 2 sections, peu de preuve visuelle | + galerie « Tous les sports » (football/tennis/basketball) |

## 7. ACTION HUMAINE REQUISE

Aucune. Pas de promesse produit ambiguë restante sur ce périmètre, pas de décision business à trancher.

## 8. Fichiers modifiés

`full-communication.html`, `full-communication-clubs.html`, `full-communication-coachs.html`, `full-communication-academies.html`, `full-communication-evenements.html`, `club-plus.html`, `connect.html`, `accompagnements-academies.html`, `accompagnements-evenements.html`, `accompagnements-joueurs.html`. `accompagnements.html` et `accompagnements-coachs.html` : aucun changement nécessaire. Header/footer/navbar non touchés sur aucun fichier.
