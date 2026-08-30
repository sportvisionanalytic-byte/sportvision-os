# SEO technique — Schema.org avancé, redirections, Core Web Vitals

Chantier autonome, un parmi 5 lancés en parallèle. Périmètre exclusif : données structurées Schema.org (Organization/LocalBusiness, BreadcrumbList, Service), audit des redirections `netlify.toml`, et une mesure réelle Lighthouse. S'appuie sur l'audit de la nuit précédente (`AUDIT_FORMULAIRES_LEGAL_SEO_PRICING.md`) qui a déjà validé title/description/canonical/OG/Twitter/FAQ JSON-LD sur les 37 pages — non revérifié ici. Aucune image touchée (périmètre d'un autre agent), aucun prix visible modifié.

---

## 1. Organization / LocalBusiness — déjà en place, complété

`index.html` avait déjà un bloc `ProfessionalService` (sous-type de `LocalBusiness` dans la hiérarchie Schema.org) ajouté lors d'un audit du 8 août et mis à jour le 16 août : nom, adresse, e-mail, téléphone, `sameAs` Instagram, zones d'intervention (Yonne, Île-de-France) — tout correspondait déjà à `mentions-legales.html`, rien à corriger sur ces champs.

Ce qui manquait et a été ajouté :
- `"@type": ["ProfessionalService", "LocalBusiness"]` — type explicite en plus de `ProfessionalService`, pour lever toute ambiguïté avec les outils qui cherchent spécifiquement `LocalBusiness`.
- `"@id": "https://sportvision-an.fr/#organization"` — ancre stable, réutilisée comme `provider` dans les schémas `Service` (voir §3).
- `"identifier"` : deux `PropertyValue` explicites SIREN (`105 173 124`) et SIRET (`105 173 124 00014`), au format exact affiché dans `mentions-legales.html`. Avant cet ajout, seul le `taxID` (numéro de TVA `FR15105173124`) était présent — le SIREN/SIRET n'a pas d'équivalent officiel en Schema.org, d'où l'usage de `PropertyValue`.

Rien d'inventé : aucune note, aucun avis, aucun chiffre non présent sur le site n'a été ajouté.

---

## 2. BreadcrumbList — ajouté sur 21 pages

Aucune des 21 pages ciblées n'avait de `BreadcrumbList` avant cette session (confirmé programmatiquement : seul `FAQPage` était présent sur les 21). Le breadcrumb reflète la navigation réelle du site (liens "← Toutes les prestations" / "Full Communication" / "Tous les accompagnements" trouvés dans le code de chaque page), pas une arborescence inventée.

**Point important** : le site a un item de nav "Solutions" (consigne initiale), mais c'est un simple bouton de menu déroulant sans page ni URL propre — il regroupe Club+, Full Communication et les accompagnements dans un seul dropdown. Insérer "Solutions" comme maillon de breadcrumb aurait donc nécessité un `item` sans URL réelle, ce qui contredit la consigne "pas une arborescence inventée". J'ai utilisé à la place le vrai parent de navigation de chaque page (celui vers lequel elle renvoie réellement) :

| Page | Breadcrumb inséré |
|---|---|
| `full-communication.html` | Accueil → Full Communication (2 niveaux, page hub) |
| `full-communication-clubs.html` | Accueil → Full Communication → Clubs |
| `full-communication-coachs.html` | Accueil → Full Communication → Coachs |
| `full-communication-academies.html` | Accueil → Full Communication → Académies |
| `full-communication-evenements.html` | Accueil → Full Communication → Tournois et événements |
| `accompagnements.html` | Accueil → Accompagnements (2 niveaux, page hub) |
| `accompagnements-academies.html` | Accueil → Accompagnements → Académies |
| `accompagnements-coachs.html` | Accueil → Accompagnements → Coachs et préparateurs |
| `accompagnements-joueurs.html` | Accueil → Accompagnements → Joueurs |
| `accompagnements-evenements.html` | Accueil → Accompagnements → Tournois et événements |
| `prestation-camera-isolee.html` | Accueil → Prestations → Caméra Isolée Joueur |
| `prestation-coachs.html` | Accueil → Prestations → Coachs et préparateurs |
| `prestation-creations.html` | Accueil → Prestations → Créations Graphiques |
| `prestation-match-photo.html` | Accueil → Prestations → Match Photo |
| `prestation-match-video.html` | Accueil → Prestations → Match Vidéo |
| `prestation-media-day.html` | Accueil → Prestations → Media Day |
| `prestation-montage-compilation.html` | Accueil → Prestations → Montage & Compilation Vidéo |
| `prestation-pack-match.html` | Accueil → Prestations → Pack Match Complet |
| `prestation-shooting-equipe.html` | Accueil → Prestations → Shooting d'Équipe |
| `prestation-shooting-joueur.html` | Accueil → Prestations → Shooting Joueur |
| `prestation-tournois.html` | Accueil → Prestations → Couverture Tournois & Stages |

Les URL utilisées dans chaque `item` sont les canonicals réels de chaque page (`https://sportvision-an.fr/prestations`, `/full-communication`, `/accompagnements`, etc.), déjà vérifiés cohérents avec `sitemap.xml` par l'audit précédent.

---

## 3. Service — ajouté sur les 11 pages `prestation-*.html`

Aucun `Product`/`Offer` n'existait déjà sur ces pages (seul `FAQPage`) — schéma `Service` créé de zéro sur les 11 pages, avec `provider` pointant vers l'Organization définie en §1 (mêmes coordonnées) et `areaServed: ["Yonne", "Île-de-France"]`.

**Prix : vérifié un par un contre le texte affiché sur chaque page** (capture d'écran de contrôle sur `prestation-match-photo.html` : "120 € TTC" affiché = "120 € TTC" dans le JSON-LD), pour ne pas reproduire le bug FAQ/texte désynchronisé corrigé la veille.

| Page | Prix affiché sur la page | Prix inséré dans `Service.offers` |
|---|---|---|
| `prestation-match-photo.html` | 120 € TTC | `price: 120`, EUR, TVA incluse |
| `prestation-match-video.html` | 120 € TTC | `price: 120`, EUR, TVA incluse |
| `prestation-pack-match.html` | 160 € TTC | `price: 160`, EUR, TVA incluse |
| `prestation-camera-isolee.html` | 150 € TTC | `price: 150`, EUR, TVA incluse |
| `prestation-montage-compilation.html` | "Dès 39,90 € HT" (tarif variable selon durée/nombre de matchs : 39,90 / 40 / 55 / 70 / 80 € HT) | `price: 39.90`, EUR, **TVA non incluse** (HT), avec description précisant qu'il s'agit d'un tarif de base |
| `prestation-coachs.html` | Aucun prix affiché ("Devis sur mesure") | **Aucune offre chiffrée ajoutée** |
| `prestation-creations.html` | Aucun prix affiché ("Devis sur mesure") | **Aucune offre chiffrée ajoutée** |
| `prestation-media-day.html` | Aucun prix affiché ("Sur devis") | **Aucune offre chiffrée ajoutée** |
| `prestation-shooting-equipe.html` | Aucun prix affiché ("Sur devis") | **Aucune offre chiffrée ajoutée** |
| `prestation-shooting-joueur.html` | Aucun prix affiché ("Sur devis") | **Aucune offre chiffrée ajoutée** |
| `prestation-tournois.html` | Aucun prix affiché ("Devis sur mesure") | **Aucune offre chiffrée ajoutée** |

Pour les 6 pages "sur devis", aucun `offers` n'a été ajouté plutôt que d'inventer un prix ou une fourchette non affichée — le `Service` reste valide sans `Offer` (propriété optionnelle en Schema.org).

**Note en marge (hors périmètre, à documenter seulement)** : sur `prestation-camera-isolee.html`, `prestation-pack-match.html` et `prestation-match-photo/video.html`, les autres tarifs (40 €, 120 €, 160 €) qui apparaissent en dehors du prix principal sont des mentions de prestations croisées (upsell/comparatif), pas des incohérences — vérifié en lisant le contexte autour de chaque occurrence. Rien à signaler à l'agent qui centralise les prix.

---

## 4. Redirections 301 / URLs orphelines — audit fait, rien à ajouter

Vérification programmatique : les 36 fichiers `.html` indexables du dossier ont chacun une entrée de redirection vers leur URL "propre" dans `netlify.toml` (`index.html` excepté, servi nativement à `/` par Netlify ; `offres.html` excepté, c'est volontairement une page de redirection côté client vers `prestations.html`, `noindex`).

`git log --diff-filter=D` sur l'historique complet du dossier `livrables/SportVision/` ne montre **aucune page `.html` supprimée ou renommée** depuis la création du site — donc aucune ancienne URL héritée à raccrocher. Aucune redirection manquante identifiée, aucune ajoutée.

---

## 5. Core Web Vitals — vrai Lighthouse (pas une estimation)

Contrairement à une tentative précédente cette nuit, **Lighthouse a fonctionné dans cet environnement** cette fois (`npx lighthouse` v13.4.1, Chrome headless, contre un serveur statique local `python3 -m http.server` servant le dossier tel quel — pas contre la prod, donc pas de latence réseau réelle ni de CDN, mais mesure réelle du poids/du rendu/des scripts, pas une estimation manuelle).

| Page | Performance | Accessibilité | Best Practices | SEO | LCP | CLS | TBT | Poids total | Requêtes |
|---|---|---|---|---|---|---|---|---|---|
| `index.html` | 94 | 98 | 100 | 100 | 2.9 s | 0.003 | 0 ms | 496 KiB | 7 |
| `prestations.html` | 94 | 95 | 100 | 100 | 2.5 s | **0.109** | 0 ms | 1 090 KiB | 10 |
| `prestation-match-photo.html` | 93 | 98 | 100 | 100 | 2.5 s | 0.099 | 0 ms | 1 833 KiB | 11 |
| `reserver.html` | 98 | 98 | 100 | 100 | 2.0 s | 0.043 | 0 ms | 178 KiB | 5 |

Points factuels ressortis de l'audit (pas de correctif appliqué, hors périmètre images) :
- **`prestations.html` a un CLS de 0.109**, au-dessus du seuil "bon" (0.1). Cause identifiée précisément par Lighthouse (`layout-shifts` audit) : **le chargement des polices variables auto-hébergées** (`manrope-variable-latin.woff2`, `inter-variable-latin.woff2`) provoque un décalage de texte au moment où elles remplacent la police système. Ce n'est pas un problème d'image sans `width`/`height` (déjà audité et propre par ailleurs) — c'est un FOUT (Flash of Unstyled Text) classique. Solution habituelle (non appliquée ici, hors périmètre strict de ce chantier) : `font-display: optional` au lieu de `swap`, ou une police système en fallback avec des métriques proches pour réduire le saut de mise en page.
- **`prestation-match-photo.html` pèse 1,8 Mo**, le plus lourd des 4 pages testées, tiré par 6 images JPEG de la section "Réalisations" (485 KiB, 315 KiB, 280 KiB, 265 KiB, 201 KiB, 165 KiB) — poids images, périmètre d'un autre agent en parallèle, signalé ici pour information seulement.
- Zéro ressource bloquant le rendu (`render-blocking-resources`) sur les 4 pages testées.
- TBT (Total Blocking Time) à 0 ms partout — pas de JS long qui bloque l'interactivité.

Limites de cette mesure, à énoncer clairement : test en local (pas de latence réseau réelle vers sportvision-an.fr/Netlify/CDN), seulement 4 pages sur 37 auditées en profondeur (les plus représentatives : accueil, catalogue, fiche prestation la plus lourde, tunnel de réservation), une seule passe par page (pas de médiane sur plusieurs runs). Les résultats JSON bruts sont dans le scratchpad de la session, pas committés dans le dépôt.

---

## 6. Vérification technique — Playwright

Sur les 22 pages touchées (`index.html` + les 21 pages breadcrumb, dont 11 avec `Service` en plus) : chargement réel via serveur statique local, `JSON.parse()` de chaque `<script type="application/ld+json">` exécuté dans le navigateur, écoute des événements `console.error` et `pageerror`.

**Résultat : 22/22 pages OK.** 56 blocs JSON-LD au total sur les fichiers touchés, tous syntaxiquement valides, zéro erreur console, zéro erreur JS. Capture d'écran de contrôle sur `prestation-match-photo.html` et `index.html` : rendu visuel identique, rien de cassé (les ajouts sont dans le `<head>`, invisibles à l'écran par nature).

---

## Fichiers modifiés

- `index.html` — Organization/LocalBusiness complété (identifiants SIREN/SIRET, `@id`, type explicite)
- `prestation-camera-isolee.html`, `prestation-coachs.html`, `prestation-creations.html`, `prestation-match-photo.html`, `prestation-match-video.html`, `prestation-media-day.html`, `prestation-montage-compilation.html`, `prestation-pack-match.html`, `prestation-shooting-equipe.html`, `prestation-shooting-joueur.html`, `prestation-tournois.html` — BreadcrumbList + Service
- `full-communication.html`, `full-communication-clubs.html`, `full-communication-coachs.html`, `full-communication-academies.html`, `full-communication-evenements.html` — BreadcrumbList
- `accompagnements.html`, `accompagnements-academies.html`, `accompagnements-coachs.html`, `accompagnements-joueurs.html`, `accompagnements-evenements.html` — BreadcrumbList
- `netlify.toml` — non modifié (audit fait, rien à ajouter, voir §4)
