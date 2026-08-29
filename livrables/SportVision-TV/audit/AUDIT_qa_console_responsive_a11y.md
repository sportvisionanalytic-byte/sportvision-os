# Audit QA transverse — console, responsive, accessibilité (29/08)

Mission nocturne autonome. QA fonctionnelle réelle (pas de retouche esthétique — la passe polish premium du même jour est intacte) menée avec Playwright (chromium) sur le site déployé réel `https://bc6m3cgdz.sportvision-an.fr/` (branche `main`, donc l'état d'avant les corrections ci-dessous), avec 7 comptes de test créés via l'API Admin Supabase (un par rôle), un par vue de la sidebar, et supprimés en fin de mission.

**Couverture** : 7 rôles (admin, sec, prod, photo, cm, com, compta) × 2 viewports chacun (mobile 390×844 pour photo/cm/com/prod, tablette 768×1024 pour admin/sec/compta, desktop 1440×900 pour tous) × la totalité des écrans de la sidebar de chaque rôle = **268 combinaisons écran×viewport testées**, avec écoute `pageerror`, `console.error`, `requestfailed` et réponses HTTP ≥400 sur toute la session.

**Résultat console/réseau : 0 erreur détectée**, toutes vues confondues, tous rôles, tous viewports. La passe polish premium récente + les audits précédents ont laissé l'OS très propre sur ce plan — cette mission n'a donc rien trouvé à corriger côté erreurs JS/réseau, mais a trouvé et corrigé 3 bugs réels côté accessibilité/responsive, invisibles à l'inspection visuelle seule.

---

## Corrigé

### 1. Piège de focus clavier absent sur toutes les modales (`#sv-modal`)
**Fichier** : `livrables/SportVision-TV/SportVision-OS-Full.html`, fonctions `openModal()`/`closeModal()` (~ligne 4075) + listener global `keydown` (~ligne 27359).

Testé en conditions réelles (Tab répété après ouverture de la modale CTA du tableau de bord, sur les 6 rôles qui en ont une : admin, sec, prod, cm, com — `focusableCount` 7 à 19 selon le rôle) : **le focus s'échappait systématiquement vers les boutons de la page derrière la modale** (`escaped:true` dans les 6 cas), et aucun focus initial n'était posé à l'ouverture (le focus restait sur le bouton qui avait ouvert la modale, en dessous de l'overlay). `#sv-modal` étant le composant modal unique et partagé par la quasi-totalité des ~200 appels `openModal()` de l'app (aucun deuxième système de modale trouvé), corriger ces deux fonctions corrige tout l'OS d'un coup — même logique que les patches CSS "polish premium" du même jour.

Corrections apportées :
- À l'ouverture : le premier élément focusable de la modale reçoit le focus (`_modalFocusFirst()`).
- Tab/Shift+Tab reste cantonné aux éléments focusables de la modale (ajout dans le listener `keydown` existant, à côté du `Escape` déjà géré).
- À la fermeture : le focus revient sur l'élément qui avait ouvert la modale (`_modalPrevFocus`).

Vérifié en réel après correction (test local sur le fichier modifié, avec un vrai compte admin) : premier Tab → entre directement dans la modale (`f-client-search`), 20 Tab consécutifs restent dans la modale et bouclent correctement, Escape referme la modale et rend le focus au bouton `#cta-btn` d'origine.

### 2. Bouton de fermeture du menu mobile sans label accessible
**Fichier** : même fichier, ~ligne 652 (`.mob-sb-close`).

Détecté sur les 7 rôles (scan a11y systématique) : le bouton `✕` qui referme le tiroir de navigation mobile (`closeMobNav()`) n'avait ni `title` ni `aria-label`, contrairement à ses voisins directs (`.mob-ham` → `title="Menu"`, bouton déconnexion → `title="Se déconnecter"`). Ajouté `title="Fermer le menu" aria-label="Fermer le menu"`.

### 3. Barre de recherche du Centre SportVision illisible/inutilisable en mobile et tablette (≤768px)
**Fichier** : même fichier, fonction `_centreView()` (~ligne 29513).

Repéré visuellement sur une capture d'écran (rôle prod, mobile) : un petit rectangle vide à gauche des onglets "Accueil / À propos / …", sans texte. Diagnostic confirmé par mesure DOM réelle : à ≤768px, `#centre-sidenav` passe en ligne horizontale scrollable (`flex-direction:row`, même patron que `#photo-pre-tabs`), mais le `<div>` qui contient le champ de recherche n'avait pas de largeur ni de `flex-shrink:0` — il se faisait donc écraser par le flex-shrink jusqu'à **26px de large** (mesuré), rendant le placeholder "Rechercher…" invisible et le champ pratiquement impossible à cliquer/utiliser. Présent en tablette (768px déclenche déjà le même point de rupture que le mobile) autant qu'en mobile — donc pour **tous les rôles**, pas seulement les rôles terrain.

Corrigé en donnant un id au wrapper (`#centre-search-wrap`) et une règle `flex-shrink:0;width:150px` dans le `@media(max-width:768px)` déjà existant — même patron que les autres rangées scrollables à largeur fixe de l'app. Revérifié en réel sur le fichier corrigé : le champ fait maintenant 122px de large (au lieu de 26px) et le placeholder est lisible.

### 4. `role="dialog"` / `aria-modal="true"` manquants sur la modale partagée
**Fichier** : même fichier, ~ligne 614 (`#sv-modal`).

Purement additif, aucun risque de régression : ajouté au conteneur `#sv-modal` en même temps que le correctif du piège de focus (les deux vont naturellement ensemble pour qu'un lecteur d'écran annonce correctement l'ouverture d'une boîte de dialogue modale).

---

## Amélioré

Rien à signaler dans cette catégorie : les 3 bugs ci-dessus étaient nets et sûrs à corriger directement (fonctions/composants partagés, correctifs additifs), pas de zone grise nécessitant un compromis.

---

## À surveiller

- **Champs natifs `date`/`time` dans les modales** : lors du test du piège de focus, chaque `<input type="date">` / `<input type="time">` a présenté 4 arrêts Tab consécutifs (segments jour/mois/année, heure/minute gérés nativement par Chromium). C'est un comportement standard du navigateur, pas un bug (pas de doublon d'`id` réel dans le DOM — vérifié), mais ça rend la navigation clavier dans les formulaires de prestation un peu longue sur les modales avec plusieurs champs date/heure (ex. "Nouvelle prestation" : 11 à 19 arrêts focusables selon le rôle). Aucune action nécessaire, juste un point de friction UX mineur à garder en tête si un jour la navigation clavier des formulaires est retravaillée.
- **Rangées horizontalement scrollables sans indice visuel de contenu caché** : plusieurs endroits de l'app (tabs "Mes missions" du photographe, colonnes du pipeline commercial en mobile, onglets du Centre SportVision) utilisent un scroll horizontal sans dégradé ni flèche indiquant qu'il y a plus de contenu à droite. Ce n'est pas un bug — le contenu reste atteignable au doigt — mais un utilisateur peu habitué peut ne pas deviner qu'il faut swiper. Pas corrigé ici (c'est un choix de design cohérent dans tout l'app, pas un bug isolé — changer ce patron toucherait de nombreux écrans et sort du cadre "corriger un bug clair").
- **Focus-visible confirmé fonctionnel** : la règle globale `:focus-visible{outline:2px solid var(--acc);outline-offset:2px}` a été vérifiée par vraie navigation clavier (Tab, pas juste `.focus()` programmatique) sur les 7 rôles × 2 viewports : contour bleu 2px net et visible à chaque fois. Rien à corriger.

---

## Action externe nécessaire

Aucune. Cette mission n'a pas identifié de credential manquant, de décision produit ambiguë ni de suppression/migration destructive.

---

## Non modifié volontairement

- **Aucune vue n'a présenté d'erreur console, d'erreur réseau (404/500) ni d'overflow horizontal de page** sur les 268 combinaisons écran×viewport testées — rien à corriger sur ce plan, l'app est propre suite aux audits et à la passe polish premium précédents.
- **Rangées scrollables sans indice visuel** (voir "À surveiller") : patron cohérent et déjà largement utilisé dans l'app, retouché uniquement là où il causait un vrai bug fonctionnel (Centre SportVision, ci-dessus), pas ailleurs — modifier le patron partout serait une décision de design qui dépasse le cadre "corriger un bug clair" de cette mission.

---

## Détail de la couverture par rôle

| Rôle | Viewports testés | Écrans sidebar couverts | Erreurs console/réseau |
|---|---|---|---|
| admin | tablette 768×1024, desktop 1440×900 | 40 écrans (dash, planning, pre, crmfullcom, crmclubplus, connectcomptes, pipeline, devis, contrats, cmagency, reservationsclubs, cotisations, demandesclub, commhub, mediabank, equipeoverview, equipehub, recrutement, prodhub, kits, incidents, fin, finrevenus, findepenses, finequipe, finrapports, calglobal, docrh, atraiter, integrations, msg, form, centre, msgclients, rdvclients, catalogue, realisations, comptesportail, avisclients, set) | 0 |
| sec | tablette 768×1024, desktop 1440×900 | 28 écrans (dash, demandes, agendasec, taches, relances, crmfullcom, crmclubplus, connectcomptes, devis, contrats, abonnements, cotisations, demandesclub, recrutement, pre, planning, livraisons, reservationsclubs, docrh, docs, msg, form, centre, msgclients, rdvclients, catalogue, avisclients, set) | 0 |
| prod | mobile 390×844, desktop 1440×900 | 9 écrans (dash, pre, livr, equipe, kits, form, centre, msg, set) | 0 |
| photo | mobile 390×844, desktop 1440×900 | 7 écrans (dash, pre, planning, revenus, form, msg, set) | 0 |
| cm | mobile 390×844, desktop 1440×900 | 9 écrans (dash, clients, planning, demandes, contenus, revenus, form, msg, set) | 0 |
| com | mobile 390×844, desktop 1440×900 | 14 écrans (dash, prospects, pipeline, agenda, commissions, devis, mesclients, objectifs, annuaire, msg, form, centre, avisclients, set) | 0 |
| compta | tablette 768×1024, desktop 1440×900 | 27 écrans (dash, resultat, rapprochement, rentabilite, commissions, immobilisations, budgets, factures, acomptes, impayes, avoirs, encaissements, cotisations, documents, paiements, rem, depenses, frais, clotures, export, fec, audit, tva, annuaire, msg, centre, set) | 0 |

---

## Méthodologie

- Comptes de test créés via l'API Admin Supabase (`SUPABASE_SECRET_KEY`), un par rôle, préfixés `qa.audit.<role>.<timestamp>@sportvision-an.fr`, tous supprimés (auth + ligne `profiles`) en fin de mission et vérifiés absents.
- Navigation automatique de tous les items de la sidebar de chaque rôle, avec réouverture du tiroir mobile (`.mob-ham` / `toggleMobNav()`) avant chaque clic en dessous de 768px (le clic sur un item ferme automatiquement le tiroir via `switchView()` → `closeMobNav()`).
- Détection d'overflow horizontal via `document.documentElement.scrollWidth > window.innerWidth`.
- Scan a11y heuristique : boutons avec texte ≤2 caractères ou vide, sans `aria-label`/`title`.
- Vérification focus-visible par vraie touche Tab (pas `.focus()` seul, qui ne déclenche pas `:focus-visible` sous Chromium).
- Piège de focus modal testé en ouvrant la modale CTA du tableau de bord de chaque rôle et en pressant Tab jusqu'à `focusableCount + 5` fois, en vérifiant à chaque pas que `document.activeElement` reste dans `#sv-modal`.
- `node --check` exécuté après chaque modification JS (via extraction des balises `<script>`).
