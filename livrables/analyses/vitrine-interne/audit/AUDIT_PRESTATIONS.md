# Audit + refonte — Prestations (catalogue + 11 fiches)

Périmètre : `prestations.html` + les 11 pages `prestation-*.html`. Header/navbar et footer non touchés (agent parallèle dédié). Vérification réelle Playwright (Chromium) sur les 12 pages, desktop 1440×900 / tablette 768×1024 / mobile 390×844, serveur statique local — voir section Vérification.

---

## Résumé

- 12/12 pages passent en 0 erreur console, 0 requête en échec (404), 0 débordement horizontal, sur les 3 viewports (36 combinaisons testées).
- 10 scénarios de clic réels (catalogue → réservation, fiche → réservation, fiche → devis, menu mobile, accordéon FAQ, modale devis) : tous fonctionnels, y compris le pré-remplissage `reserver.html?besoin=...` qui active bien l'étape 2 pour chaque prestation.
- Structure de conversion (Promesse → Inclus → Exemples → Pour qui → Livraison → Prix → Réserver) manquait sur 10/11 fiches (aucune vraie section « Exemples » avec médias réels, aucune section « Pour qui ») : ajoutée sur les 11 fiches.
- Catalogue : les 15 cartes prestations étaient des rectangles identiques (icône + texte, aucune image) avec un CTA générique « Voir la fiche X » : remplacées par des cartes avec vraie photo/vidéo en tête, CTA d'action explicite + lien secondaire vers la fiche.
- 1 incohérence de prix trouvée entre le mandat et le site — documentée en ACTION HUMAINE REQUISE, non modifiée (voir plus bas).
- 1 erreur de contenu trouvée et corrigée en cours de travail : des photos brutes d'événements client (`case-*.jpg`) étaient présentées comme des « créations graphiques » sur la fiche Créations — recadré pour rester honnête (ce sont des photos sources, pas des livrables graphiques finis).

---

## P0 — Aucun trouvé

Rien de bloquant (paiement, sécurité, formulaire cassé) sur ce périmètre.

## P1 — Corrigés

1. **Structure de conversion incomplète sur 10 fiches** (`prestation-match-photo.html`, `-match-video.html`, `-pack-match.html`, `-shooting-joueur.html`, `-shooting-equipe.html`, `-media-day.html`, `-tournois.html`, `-creations.html`, `-coachs.html`, et section « Pour qui » manquante sur `-camera-isolee.html` / `-montage-compilation.html`).
   Avant : Hero → Inclus → Pourquoi SportVision → (Délai) → Options → FAQ → CTA. Aucune section « Exemples » avec médias réels (seulement un fond décoratif flou derrière une carte de stats), aucune section « Pour qui ».
   Après : Hero (promesse) → Inclus → **Exemples** (galerie plein cadre, vrais visuels `assets/realisations/`) → Pourquoi SportVision → **Pour qui** (3 profils réels par prestation) → Délai/Options → FAQ → CTA (prix + réserver).
   Toutes les images utilisées existent déjà dans le dossier `assets/realisations/` (aucun visuel créé ou halluciné) — vérifié fichier par fichier (55 références, 0 manquante).

2. **Catalogue `prestations.html` : cartes génériques sans image, CTA vague.**
   Avant : 15 cartes identiques (pictogramme sur fond uni + « Voir la fiche X »).
   Après : chaque carte affiche une vraie photo/vidéo en tête (aspect 16/10, plein cadre dans la carte), hover avec zoom média léger + translation + ombre. CTA principal explicite (« Réserver cette prestation » ou « Demander un devis » selon que le prix est fixe ou sur devis) pointant directement vers `reserver.html?besoin=...`, avec un lien secondaire « Voir la fiche complète → » vers la page dédiée. Vérifié que les 14 valeurs `besoin=` utilisées correspondent bien aux slugs `data-slug` du sélecteur de `reserver.html`.

3. **Cartes d'options sans aucun bouton d'action** sur `prestation-tournois.html` (3 cartes : drone, partenaires, aftermovie) et `prestation-creations.html` (2 cartes : pack, identité visuelle) — aucun lien, aucun `data-action`, l'utilisateur ne pouvait pas agir sur ces options depuis la carte. Ajout d'un CTA « Ajouter cette option » cohérent avec le reste du site (`data-action="open-devis"`), vérifié en clic réel (ouvre bien la modale devis).

4. **Contenu trompeur sur `prestation-creations.html` (trouvé et corrigé en interne, avant tout commit visible).**
   En construisant la galerie « Exemples » de la fiche Créations graphiques, j'ai d'abord utilisé des photos `assets/realisations/case-*.jpg` en les légendant « Création graphique ». Vérification visuelle : ce sont des photos brutes d'événements (célébration de match, séance de dribble en académie...), pas des visuels graphiques composés — aucun asset de ce type n'existe dans le dossier. Recadré : la galerie et son texte d'intro présentent maintenant ces photos comme la **matière première** (vos vraies photos) à partir de laquelle SportVision compose vos créations, ce qui est exact et vérifiable. Le même correctif a été appliqué à la vignette du catalogue (`prestations.html`), qui utilisait la même photo avec le même alt text trompeur.

## P2 — Corrigés

- Alternance des fonds de section (`section-light` / `section-tint`) réajustée sur les fiches où j'ai inséré une nouvelle section, pour ne pas casser le rythme visuel existant.
- Accessibilité : tous les nouveaux visuels ont un `alt` descriptif (jamais vide ni générique type « image »), `loading="lazy"` sur les images ajoutées sous la ligne de flottaison.
- CSS dupliquée : `prestation-camera-isolee.html` et `prestation-montage-compilation.html` n'avaient jamais reçu le bloc `.accomp-card` (présent sur les 10 autres fiches) — ajouté à l'identique pour supporter la nouvelle section « Pour qui ».

## P3 — Notés, non traités (mineurs, cosmétiques)

- Les CSS `.case-grid`, `.testi-grid`, `.tabs-bar`, `.paths-grid` restent présentes mais inutilisées dans le `<style>` de plusieurs fiches (poids mort hérité d'un template commun). Ne cause aucun bug, laissé en l'état pour ne pas gonfler le diff au-delà du périmètre demandé.

---

## Incohérence de prix — ACTION HUMAINE REQUISE

Le mandat de cette campagne indique comme prix confirmé pour Montage & compilation : **39,90 € HT** (rushs pré-découpés ≤6 min) et **40 / 55 / 70 / 80 € HT** (1 à 4 matchs via lien Veo).

Le site (fiche `prestation-montage-compilation.html`, catalogue `prestations.html`, **et** le moteur de réservation `reserver.html` — hors périmètre mais lu pour vérification) affiche de façon parfaitement cohérente entre eux : **40 € TTC** (rushs ≤6 min) et **40 / 60 / 80 / 100 € TTC** (1 à 4 matchs, +20 €/match). Ces trois emplacements s'accordent entre eux — il n'y a donc pas d'incohérence *interne* au site, seulement un écart avec le chiffre indiqué dans le mandat.

Je n'ai pas modifié ces valeurs : `reserver.html` est le moteur qui calcule réellement le montant facturé (menu déroulant `data-price` utilisé pour le récapitulatif de commande) — si j'avais aligné uniquement la fiche sur les chiffres du mandat sans toucher au moteur de réservation (hors périmètre de cette campagne), la fiche aurait affiché un prix différent de celui réellement facturé au client, ce qui aurait créé un vrai bug. **ACTION HUMAINE REQUISE : confirmer laquelle des deux séries de prix (39,90/55/70/80 € HT du mandat, ou 40/60/80/100 € TTC actuellement sur le site + reserver.html) est la bonne, puis aligner les trois emplacements en conséquence** (`prestation-montage-compilation.html`, `prestations.html`, `reserver.html`).

Tous les autres prix du mandat sont cohérents avec ce qui est actuellement affiché sur le site et n'ont pas été modifiés :
- Caméra isolée joueur : 150 € TTC ✓
- Combo Drone + Photo : 160 € TTC ✓
- Combo Véo + Photo : 180 € TTC ✓ (c'est la prestation qui correspond au « Pack Photo + Vidéo + Highlight 4K » du mandat — à ne pas confondre avec « Pack Match Complet », un produit distinct à 160 € TTC qui réunit Match photo + Match vidéo sans drone/Véo)
- Match filmé Véo : 120 € ✓

---

## Copywriting

Audit des 12 pages : les textes existants étaient déjà globalement bons (phrases courtes, bénéfice + preuve, pas de jargon, pas de chiffre inventé). Interventions :
- Nouvelles sections « Exemples » et « Pour qui » rédigées dans le même registre (direct, sans emphase artificielle, aucune statistique ni témoignage inventé).
- Reformulation de la légende des visuels de la fiche Créations pour rester factuellement exacte (voir P1.4 ci-dessus).
- Aucune répétition mot-pour-mot introduite entre les nouvelles sections des différentes fiches malgré la structure commune (vocabulaire et angle adaptés à chaque prestation : club/joueur-famille/coach pour les prestations de match, joueur/famille/dossier de recrutement pour les shootings joueur, etc.).

---

## Vérification réelle (Playwright)

Contexte : deux autres worktrees d'agents parallèles avaient déjà des serveurs statiques lancés sur les ports 8934 et 8935 au moment du test — un premier essai de vérification a donc, sans le savoir, testé le contenu d'un **autre** agent. Repéré via `lsof`, corrigé en servant ce worktree sur un port dédié (19345) avant de relancer tous les tests.

- **36 checks (12 pages × 3 viewports : 1440×900 / 768×1024 / 390×844)** : navigation OK, 0 erreur console, 0 erreur JS non gérée, 0 requête HTTP en échec (404/500), 0 débordement horizontal (`scrollWidth` vs `clientWidth`).
- **10 scénarios de clic réel** (pas de `page.evaluate()`) : catalogue → `reserver.html?besoin=X` avec activation automatique de l'étape 2 (pré-remplissage), catalogue → lien « Voir la fiche complète », fiches à prix fixe et fiches sur devis → réservation, menu burger mobile (ouverture + navigation dans l'accordéon « Prestations »), accordéon FAQ, modale « Demander un devis » (CTA générique et CTA d'option nouvellement ajouté). 0 échec.
- **55 références d'images** `assets/realisations/*` utilisées dans ces 12 pages vérifiées une à une contre le contenu réel du dossier : 0 manquante.
- Vérification visuelle par capture d'écran (desktop et mobile, y compris après un scroll programmatique complet pour déclencher les animations `reveal` en `IntersectionObserver`, qui n'apparaissent pas sur une capture plein-page instantanée — comportement normal, pas un bug).

---

## Fichiers modifiés

- `livrables/SportVision/prestations.html`
- `livrables/SportVision/prestation-match-photo.html`
- `livrables/SportVision/prestation-match-video.html`
- `livrables/SportVision/prestation-pack-match.html`
- `livrables/SportVision/prestation-shooting-joueur.html`
- `livrables/SportVision/prestation-shooting-equipe.html`
- `livrables/SportVision/prestation-media-day.html`
- `livrables/SportVision/prestation-tournois.html`
- `livrables/SportVision/prestation-creations.html`
- `livrables/SportVision/prestation-coachs.html`
- `livrables/SportVision/prestation-camera-isolee.html`
- `livrables/SportVision/prestation-montage-compilation.html`

Header/navbar et footer non modifiés sur aucun de ces fichiers (uniquement le contenu entre les deux). Aucun autre fichier du dossier touché.
