# PRICING_CENTRALISATION.md

Centralisation des tarifs SportVision (30/08/2026) — chantier isolé parmi 5 lancés en parallèle sur des périmètres différents, worktree isolé, aucun push (fusion par Fouka après revue).

---

## 1. Problème traité

Le site (`livrables/SportVision/`, 37 pages HTML statiques, aucun build, Netlify) n'a pas de templating : chaque prix est écrit en dur, dupliqué sur plusieurs pages à la fois (catalogue, fiche prestation, `<title>`/`<meta description>`/JSON-LD, et le moteur de réservation `reserver.html`). L'audit de la nuit précédente (`SPORTVISION_SITE_FINAL_AUDIT.md`) avait déjà trouvé et corrigé une incohérence née de cette duplication : « Montage & compilation » affiché à un tarif différent (40/60/80/100 € TTC) sur 5 pages simultanément, au lieu de 39,90 € HT / 40-55-70-80 € HT. Objectif de ce chantier : une source unique de vérité pour que ce type de dérive redevienne détectable en une commande.

## 2. Contrainte technique respectée

Aucun `<title>`/`<meta description>`/JSON-LD n'a été transformé en contenu injecté en JS : ces balises restent du texte statique lisible sans exécuter de JavaScript (SEO, aperçus de partage social Slack/WhatsApp/iMessage). Les prix y restent donc écrits en dur, volontairement. Seul `reserver.html` (le moteur de réservation, un vrai tunnel interactif sans enjeu SEO sur son contenu dynamique) a été centralisé en runtime.

## 3. Ce qui a été livré

### `pricing-config.js`
Source unique de vérité, 21 entrées couvrant : les 8 prestations à prix fixe (match photo/vidéo, Pack Match Complet, caméra isolée, match filmé drone/Véo, combo drone+photo, combo Véo+photo), Montage & compilation (prix "à partir de" + grille de 6 paliers), 6 prestations sur devis, l'option tarifée "Plans drone ou Véo complémentaires" (+40 €), les 3 formules Club+ (Gratuit/Start/Performance, avec engagement/sans engagement, crédits, remises 5 %/10 %), Full Communication (sans prix public, Club+ inclus sans coût supplémentaire) et le capital social SASU (pour que le script de vérification ne le signale pas à tort comme un tarif de prestation).

Chaque valeur a été vérifiée contre au moins 2 endroits déjà en production (grep systématique des 37 pages) avant d'être considérée confirmée — voir §5 pour la méthode et §6 pour les deux valeurs qui restent à confirmer humainement (remise Club+, capital social — non ambiguës mais sensibles).

En-tête du fichier : explique pourquoi le HTML statique garde ses prix en dur, comment `reserver.html` s'en sert réellement, comment lancer le script de vérification, et la procédure pour tout futur changement de prix.

### `pricing-config.json`
Miroir strict de `pricing-config.js`, généré programmatiquement (`node -e "require('./pricing-config.js')"` → `JSON.stringify`), donc garanti identique valeur pour valeur — pas de recopie manuelle possible. **`pricing-config.js` reste la source canonique** (c'est lui que le navigateur charge sur `reserver.html`) ; `pricing-config.json` n'est qu'une projection technique pour le script Python (stdlib uniquement, ne peut pas exécuter du JS). Toute édition future doit modifier `pricing-config.js` puis régénérer le miroir avec la même commande.

### `reserver.html` — centralisation runtime réelle
- `<script src="pricing-config.js"></script>` ajouté avant le script du tunnel.
- `OFFRES_PRIX_FIXE` (liste des prestations à tarif fixe) n'est plus une liste recopiée à la main : elle est dérivée de `PRICING_CONFIG` (`Object.keys(...).filter(slug => typeof price === 'number')`).
- Nouvelle fonction `applyPricingConfig()`, appelée au chargement, qui réécrit à partir de `PRICING_CONFIG` : le `data-price` et le prix affiché des cartes de besoin (étape 1), les paliers du `<select>` Montage & compilation (étape 3, reconstruit dynamiquement), et le libellé/montant de l'option "Plans drone ou Véo complémentaires".
- Filet de sécurité : si `pricing-config.js` ne charge pas, `PRICING` retombe sur un objet vide et `applyPricingConfig()` ne modifie rien — le HTML statique existant (déjà à jour) continue de s'afficher normalement, aucune régression possible.
- Une fonction `formatPriceFr` dupliquée deux fois dans le fichier a été fusionnée en une seule définition (nettoyage, aucun changement de comportement).

### `scripts/check-pricing-consistency.py`
Script Python autonome (stdlib uniquement : `json`, `re`, `os`, `unicodedata`). Charge `pricing-config.json`, scanne les 37 fichiers `.html` à la recherche du motif `\d+[,.]?\d*\s*€`, associe chaque prix trouvé au(x) prestation(s) évoquée(s) à proximité (mots-clés + "sujet par défaut" de la page pour les fiches mono-prestation), vérifie la valeur contre les tarifs attendus, et vérifie séparément les remises Club+ en % sur les lignes contenant "remise"/"réduction". Rapport clair (compte de prix cohérents / suspects, fichier:ligne + valeur + contexte + raison), code de sortie non nul si un vrai problème est trouvé.

## 4. Résultat du script sur l'état actuel

```
Fichiers HTML scannés : 37
Prix (€) trouvés cohérents avec PRICING_CONFIG : 137
  dont sans contexte de prestation identifié (valeur connue ailleurs) : 6
Remises (%) Club+ trouvées cohérentes : 4

Aucune incohérence trouvée. Le site est cohérent avec pricing-config.js.
```
Code de sortie : `0`.

**Preuve que le script détecte réellement une régression** (et n'est pas vert par construction) : un prix de `prestation-montage-compilation.html` a été temporairement remplacé (39,90 € → 45,00 €) pour le test, en local, jamais commité. Le script est immédiatement passé à 8 occurrences signalées avec le message `Prestation détectée (montage-compilation, option-drone-veo) mais valeur 45€ absente des tarifs attendus (39.9, 40, 55, 70, 80 €)` et code de sortie `1`. Le fichier a été restauré immédiatement après (`git diff` confirmé vide).

## 5. Méthode de vérification des valeurs

Chaque prix de `PRICING_CONFIG` a été confirmé par recherche exhaustive (`grep -rn` sur les 37 pages) plutôt que recopié depuis une seule source :
- Les 8 prestations à prix fixe et Montage & compilation : confirmées identiques sur `index.html`, `prestations.html`, la fiche prestation dédiée, et `reserver.html`.
- L'option "+40 €" (drone/Véo) : confirmée sur 3 fiches prestations (`prestation-match-photo.html`, `prestation-match-video.html`, `prestation-pack-match.html`) et `reserver.html`.
- Les 3 formules Club+ (prix, crédits, utilisateurs/équipes) : confirmées sur `club-plus.html` (cartes de formule + tableau comparatif, deux emplacements indépendants sur la même page).
- Les remises Club+ (5 % Start / 10 % Performance) : confirmées sur `club-plus.html` (liste de fonctionnalités + tableau comparatif) et recoupées avec le commit git `9ffd6a2` qui cite la source de calcul réelle du panier Connect (`PLAN_SERVICE_DISCOUNT_PCT` dans `SportVision-Connect/app-next/src/lib/types/services.ts`, commentaire : "Confirmée par Fouka le 11/08/2026 : 5% Club+ Start, 10% Club+ Performance, 20% Full Communication").
- Full Communication : confirmé sans prix public sur les 5 pages (`full-communication*.html`), Club+ inclus sans coût supplémentaire (wording confirmé en JSON-LD FAQ + FAQ visible + section formule sur `full-communication.html`).
- Les prestations "sur devis" (shooting, tournois, stages, créations, coachs, Media Day) : confirmées sans prix public sur leurs fiches respectives et sur `reserver.html`.

Aucune page (`accompagnements*.html`, `demande-de-devis.html`, `offres.html`, `connect.html`) n'affiche de prix chiffré en dehors de ce périmètre.

## 6. Ambiguïtés — ACTION HUMAINE REQUISE

Aucune ambiguïté bloquante. Deux points de transparence, non bloquants (même esprit que le §15 de `SPORTVISION_SITE_FINAL_AUDIT.md`) :

1. **Remise Club+ 20 % Full Communication** — le commentaire du commit `9ffd6a2` mentionne une remise de 20 % pour Full Communication dans `PLAN_SERVICE_DISCOUNT_PCT` (calcul interne du panier Connect), mais cette remise n'est affichée nulle part sur le site public (Full Communication est vendu sur devis, sans grille tarifaire publique). Elle n'a donc pas été ajoutée à `pricing-config.js` — il n'y a rien à centraliser côté vitrine tant qu'elle n'est pas exposée publiquement. Si Fouka souhaite un jour l'afficher, il faudra confirmer la valeur affichée (20 % de quoi, exactement — assiette non précisée dans le commentaire du code Connect) avant de l'ajouter ici.
2. **Capital social SASU (1,00 €)** — ajouté à `pricing-config.js` uniquement pour que le script de vérification le reconnaisse et ne le signale pas à tort comme un tarif de prestation non reconnu. Ce n'est pas un tarif commercial ; aucune action requise, mentionné ici pour transparence sur le contenu du fichier.

## 7. Tests réels (Playwright, navigateur réel, aucun `page.evaluate()` pour injecter des prix)

Tunnel testé sur 6 besoins différents (match-photo, pack-match, camera-isolee, combo-veo-photo, montage-compilation, shooting), desktop (1440×900) et mobile (iPhone 13 émulé, `devices['iPhone 13']` Playwright) — 12 parcours complets, clics et saisies réels (sélection de carte, remplissage date/champs contextuels, coche d'option, sélection de palier Montage, lecture du récapitulatif final) :
- Prix affiché sur chaque carte de besoin : conforme à la valeur attendue dans les 12 cas.
- Total calculé dans le récapitulatif (prestation + option "+40 €" pour match-photo et pack-match) : `160 € TTC` et `200 € TTC` respectivement, identique au comportement d'avant centralisation.
- Palier Montage & compilation "Rushs prédécoupés (≤6 min)" : `data-price="39.9"`, récapitulatif "39,90 € HT" — conforme.
- Prestation sur devis (shooting) : récapitulatif "Tarif : sur devis — Aucun paiement maintenant." — conforme.
- 0 erreur console, 0 requête réseau en échec sur les 12 parcours.
- Vérification indépendante : `PRICING_CONFIG` se charge et expose 21 clés côté navigateur, sur `reserver.html`, desktop et mobile, console propre.

## 8. Ce qui n'a pas changé

Aucun autre fichier du site n'a été modifié. Les prix affichés dans le HTML statique des 36 autres pages restent écrits en dur (contrainte SEO, cf. §2) — ils étaient déjà cohérents avec `pricing-config.js` au moment de la vérification (§4), c'est pour ça que le script est vert sans qu'aucune correction de contenu n'ait été nécessaire cette fois-ci.

## 9. Procédure pour tout futur changement de prix

1. Modifier la valeur dans `pricing-config.js` (source canonique).
2. Reporter le même changement dans `pricing-config.json` (`node -e "require('./pricing-config.js')"` → régénérer, ne jamais éditer le JSON à la main pour éviter une désynchronisation).
3. Lancer `python3 scripts/check-pricing-consistency.py` depuis `livrables/SportVision/`.
4. Corriger chaque fichier HTML signalé (le prix y reste écrit en dur, volontairement).
5. Vérifier `reserver.html` dans un navigateur : le tunnel doit refléter le nouveau prix sans autre modification, puisqu'il le lit depuis `pricing-config.js`.

## 10. Fichiers livrés

- `livrables/SportVision/pricing-config.js` (source canonique)
- `livrables/SportVision/pricing-config.json` (miroir généré, pour le script Python)
- `livrables/SportVision/scripts/check-pricing-consistency.py` (vérification)
- `livrables/SportVision/reserver.html` (modifié : charge et lit `pricing-config.js`)
- `livrables/SportVision/audit/PRICING_CENTRALISATION.md` (ce document)
