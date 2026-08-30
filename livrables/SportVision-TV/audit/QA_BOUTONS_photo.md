# QA boutons — rôle Photographe/Vidéaste (photo), priorité mobile — 30/08/2026

Campagne de test exhaustive, en cliquant réellement sur chaque écran/bouton, avec un
vrai compte de test `qa.photo.test@sportvision-an.fr` (`role='photo'`) créé via l'API
Admin Supabase, et 5 prestations de test réelles (statuts variés : Jour J "prête" avec
RDV du jour, mission à venir à J+3 avec invitation à accepter, mission terminée
"production_terminée" pour le transfert média, mission "clôturée/payée" pour l'écran
Revenus, mission à J+7 avec invitation à refuser) + 1 kit réel du parc ("KIT alpha 1")
réservé sur la mission du jour. Playwright/chromium contre
`https://bc6m3cgdz.sportvision-an.fr/` pour le repérage, viewport mobile 390×844 en
priorité puis desktop 1440×900, puis contre une copie locale servie en HTTP
(`python3 -m http.server`, port dédié pour éviter la collision avec d'autres agents en
cours sur ce même host) pour vérifier chaque correctif avant de continuer. Toutes les
données de test ont été supprimées en fin de campagne et leur absence vérifiée
(compte auth, profil, client, 5 prestations, prestations_equipe, kit_reservation,
incidents, frais, media_liens — tout confirmé vide en re-requêtant après suppression ;
le kit réel partagé "KIT alpha 1" a été revérifié `statut:'disponible'`, intact).

Deux Mode Jour J coexistent dans le code et ont été testés séparément : l'overlay
plein écran mobile (`enterJourJ`/`renderJourJ`/`jourJAction`, atteint depuis le bouton
"Mode Jour J" du dashboard mobile) et l'écran desktop classique (`loadJourJ`/
`avanJourJ`, atteint via le menu "Plus" → "Mode Jour J" ou la sidebar desktop) — les
deux sont réellement accessibles sur mobile selon le point d'entrée.

## Bugs trouvés et corrigés

### 1. [CRITIQUE] Toutes les modales de l'OS ne recevaient aucun clic réel
En cliquant réellement (Playwright `click()`, pas un appel JS direct) sur "Envoyer"
dans la modale "Déclarer des kilomètres" (ouverte depuis les Actions rapides du Mode
Jour J mobile), rien ne se produisait : la modale s'ouvrait bien, le formulaire se
remplissait, mais le clic sur "Envoyer" était systématiquement intercepté par l'écran
en dessous. D'abord repéré comme un problème de z-index (la modale semblait cachée
derrière `#mob-jourj`), mais le vrai correctif de z-index seul n'a pas suffi — la
modale restait toujours entièrement inerte, y compris **hors** du Mode Jour J (testé
sur la modale "Refuser la mission" de l'écran "Mes missions", même symptôme).

Cause racine : `<div id="sv-modal" ... style="...;pointer-events:none">` porte
`pointer-events:none` en attribut `style` **inline**. La règle de feuille de style
`#sv-modal.on{pointer-events:auto}` censée le réactiver à l'ouverture ne peut jamais
l'emporter sur un style inline, quelle que soit sa spécificité — règle de base du CSS.
Résultat : **aucune des ~200 modales de l'OS** (tous rôles confondus, `#sv-modal` est
le composant partagé unique) ne recevait le moindre clic souris/tactile réel depuis
l'introduction de ce mécanisme opacity/visibility/pointer-events (passe "POLISH
PREMIUM" du 29/08/2026 — avant, un autre mécanisme d'ouverture était en place).

**Corrigé** : `pointer-events:none` déplacé de l'attribut `style` inline vers la règle
`#sv-modal{opacity:0;visibility:hidden;pointer-events:none;...}` (état fermé). La
règle `#sv-modal.on{pointer-events:auto}` (spécificité ID+classe, supérieure à ID
seul) la surclasse alors normalement à l'ouverture, sans avoir besoin de `!important`.
Revérifié par clic Playwright réel (coordonnées, hit-testing complet) : "Déclarer des
kilomètres" (frais créé et confirmé en base), "Signaler un incident" (cf. bug #2),
"Refuser la mission" (invitation passée à `refusée` en base, toast affiché) — tous
fonctionnels après correctif, avant/après vérifiés par requête directe.

### 2. [CRITIQUE] "Signaler un incident" (Mode Jour J mobile) échouait à 100 %
Une fois le bug #1 corrigé, soumettre le formulaire "Signaler un incident" depuis les
Actions rapides du Mode Jour J mobile affichait l'erreur brute :
`Erreur : null value in column "type_incident" of relation "incidents" violates
not-null constraint` — directement visible par le photographe, aucun incident jamais
enregistré. Cause : ce formulaire ne collecte volontairement qu'une description libre
+ un niveau (pas de champ "type", à la différence de la modale desktop équivalente
`modalSignalerIncident`/`signalerIncident` qui, elle, envoie bien `type_incident` et
n'a pas ce problème), mais `incidents.type_incident` est `NOT NULL` en base.

**Corrigé** (`submitIncidentJJ`) : valeur par défaut envoyée automatiquement —
`'Matériel'` si un kit a été précisé dans le sélecteur optionnel, `'Terrain'` sinon —
sans ajouter de champ à ce formulaire volontairement court. Testé : incident créé en
base avec la bonne valeur, toast "Incident signalé." affiché, modale fermée.

### 3. Mode Jour J mobile : les coches manuelles de la checklist s'effaçaient à chaque changement de statut
Dans l'overlay Jour J mobile, cocher "Batterie vérifiée" / "Stockage suffisant" /
"Caméra / matériel prêt" fonctionnait visuellement, mais dès que le photographe
cliquait le bouton principal pour avancer d'une étape (ex. "Démarrer la prestation"),
`jourJAction()` ré-appelle `enterJourJ()` qui reconstruit toute la checklist à partir
d'un tableau où ces 3 items étaient codés en dur à `done:false` — la coche que le
photographe venait de faire disparaissait silencieusement à l'étape suivante, sans
qu'il s'en aperçoive avant de vérifier plus tard.

**Corrigé** : ces 3 coches sont maintenant persistées en `localStorage` (clé par
prestation), relues à chaque rendu — elles survivent désormais aux changements de
statut. Les 3 autres items de la checklist ("Briefing consulté", "Kit récupéré",
"Contact sur place établi") sont dérivés automatiquement du statut réel de la mission
(logique préexistante, correcte) ; ils ne sont plus rendus cliquables pour éviter de
laisser croire au photographe qu'il peut les cocher manuellement alors que leur valeur
est de toute façon recalculée à partir de la vraie progression. Testé de bout en bout :
coche posée → clic "Démarrer la prestation" → checklist ré-affichée → coche toujours
présente.

### 4. "Mes médias" affichait (et permettait d'agir sur) une mission refusée
Une mission dont le photographe avait refusé l'invitation continuait d'apparaître dans
l'écran "Mes médias", avec un bouton "+ Lien" pleinement fonctionnel permettant d'y
associer un transfert — alors qu'elle ne lui appartient plus. Repéré en clic réel :
sur 5 missions de test dont une refusée, le premier "+ Lien" cliqué (liste triée par
date de création descendante) est tombé sur la mission refusée par erreur.

Cause : `loadPhotoMedias()` est la seule des fonctions du rôle photo lisant
`prestations_equipe_display` à ne **pas** exclure les invitations `statut='refusée'`
— `loadPhotoDash`, `loadPhotoRevenus` et (voir bug #5) `loadPhotoMesPrestations` le
font déjà, avec le même commentaire dans le code rappelant que `statut` sur cette vue
est celui de l'invitation, pas celui de la mission.

**Corrigé** : ajout du filtre `&statut=neq.refusée` à la requête, identique aux
3 autres écrans. Revérifié : la mission refusée disparaît de la liste, la mission
réellement en attente de transfert (`production_terminée`) reste accessible et le
flux "+ Lien" fonctionne dessus (voir "Testé et fonctionnel").

### 5. "Mes missions" (desktop et mobile) affichait indéfiniment les missions refusées
Même bug que #4, sur l'écran "Mes missions"/`loadPhotoMesPrestations` (le seul filtre
en place excluait les prestations `annulée`, jamais les invitations `refusée`). Une
mission refusée restait affichée dans l'onglet "Toutes" avec le badge de statut de la
prestation elle-même, indiscernable visuellement d'une mission active — et aucun
onglet "Refusées" n'existe dans les filtres de cet écran pour l'isoler intentionnellement.

**Corrigé** : même filtre `d.statut!=='refusée'` ajouté au `.filter()` côté client.
Revérifié en desktop (1440×900) : la mission refusée de test (SV-2026-0096) a disparu
de "Toutes" après correctif, les 4 missions restantes (dont celle du jour, en
médias_complets) s'affichent normalement avec le bon badge et le bon bouton contextuel
("🔴 Jour J" / "📦 Livrer").

### 6. Icônes de kit toujours génériques (📦) au lieu de l'icône du type réel
Sur le Dashboard mobile ("Kits assignés") et le Mode Jour J desktop ("🎒 Kits
assignés"), l'icône d'un kit affichait systématiquement 📦 (repli par défaut) au lieu
de l'icône propre à son type (📷 pour un kit Photo, 🎬 Vidéo, 🚁 Drone, etc.). Cause :
la table `KIT_IC`/`KIT_IC_J` utilise des clés tout-minuscule (`photo`, `vidéo`,
`drone`, `audio`, `streaming`), alors que le formulaire réel de création de kit
(`KIT_TYPES_LIST`) enregistre des valeurs capitalisées (`'Photo'`, `'Vidéo'`,
`'Drone'`, `'Son'`, …) — la recherche par clé exacte échouait donc à chaque fois,
y compris sur le seul kit réel du parc ("KIT alpha 1", `type_kit:'Photo'`).

**Corrigé** (2 occurrences dans le périmètre photo : `loadPhotoDash`, `loadJourJ`) :
recherche désormais insensible à la casse (`.toLowerCase()` côté lecture), table de
correspondance étendue pour couvrir les 13 valeurs réelles de `KIT_TYPES_LIST` (dont
`'Son'` → 🎙, qui ne matchait de toute façon jamais l'ancienne clé `audio`, un mot
différent et pas seulement une casse différente). Vérifié : "KIT alpha 1" affiche
maintenant 📷 sur le Dashboard mobile comme dans le Mode Jour J desktop (HTML rendu
inspecté directement, l'émoji est correctement injecté). Un 3ᵉ site identique existe
dans le planning hebdo Admin/Prod (`prod.kanban`, écran hors périmètre photo) — non
touché, même bug probable, à signaler pour une passe ultérieure.

## Testé et fonctionnel

- **Connexion / session** : login réel avec le compte de test, redirection correcte
  vers le dashboard photo mobile.
- **Dashboard mobile** (`loadMobilePhotoDash`) : bandeau invitation en attente
  (accepter ✓/refuser ✗ directement depuis la carte), carte "Prochaine prestation"
  avec boutons "🎯 Mode Jour J" et "🗺 Itinéraire", KPI (missions/rémunération/XP),
  liste "Mes missions à venir" avec boutons "Mode Jour J"/"Détail" par ligne.
- **Mode Jour J mobile** (`enterJourJ`/`jourJAction`), chaîne complète testée en réel
  sur une vraie mission : prête → production_démarrée → production_terminée →
  médias_à_transférer → médias_complets, à chaque étape toast "Statut mis à jour."
  et statut confirmé en base par requête directe. Lien `tel:` bien formé
  (`tel:0612345678`), lien itinéraire Google Maps bien formé et pointant sur la bonne
  adresse. Section "Équipe" affiche le collaborateur assigné.
- **Actions rapides Jour J** : "Déclarer des kilomètres" (calcul auto 0,325€/km
  vérifié : 25 km → 8,13 €, ligne créée dans `frais`) et "Signaler un incident" (avec
  sélecteur de kit concerné, qui propose bien "KIT alpha 1" puisqu'il est réservé sur
  la mission) — tous deux fonctionnels après les correctifs #1/#2.
- **Accepter/refuser une invitation** : testé les deux sens en réel — acceptation
  (déclenche l'avancement auto documenté `planifiée→équipe_affectée`) et refus (avec
  motif + commentaire via la modale dédiée) — statuts confirmés en base, toasts
  corrects, mission qui disparaît des listes actives (dashboard/revenus/mes
  missions/médias) après refus.
- **Transfert de médias** (`modalAjouterLien`/`sauvegarderLien`) : testé avec
  catégorie par défaut ("Dépôt", pas d'avancement auto — comportement voulu) puis avec
  catégorie "Rushs" + case "transfert confirmé" cochée → animation "Transfert
  confirmé !" (cercle + coche SVG animés, fermeture auto après 1,5 s) et avancement
  automatique en base `production_terminée → médias_à_transférer → médias_complets`
  en un seul envoi, conforme au commentaire du code.
- **Mes kits** : tableau listant "KIT alpha 1" avec son statut réel (`sorti`),
  défilement horizontal tactile fonctionnel (`.tw{overflow-x:auto}`, comportement
  volontaire, pas un bug).
- **Mes revenus** : filtres "Ce mois"/"Cette année"/"Tout" fonctionnels, totaux exacts
  (4 missions actives sur 5 après exclusion de la refusée = 400 €, dont 150 € payés/
  250 € en attente — vérifié au centime), graphique en barres, export CSV (code relu,
  déclenchement sans erreur).
- **Mon planning** (mensuel, mobile et desktop) : navigation mois précédent/suivant/
  "Aujourd'hui" fonctionnelle, missions positionnées sur les bonnes dates, clic sur un
  événement ouvre bien la fiche détail (`modalDetailById`), lien "Ajouter à Google
  Agenda" présent sur chaque événement.
- **Disponibilité** (desktop, `modalDisponibilite`/`setDisponibilite`) : ouverture,
  sélection "Sous conditions" (jours + horaires), sauvegarde → toast "Disponibilité
  mise à jour." (confirmé fonctionnel après le correctif #1, cassé avant).
- **Formation** : tableau de bord (XP, grade, formations obligatoires) chargé sans
  erreur avec les vraies données du compte de test.
- **Messagerie** : liste des conversations (broadcast équipe + messages privés vers
  tout le staff réel) chargée sans erreur.
- **Annuaire** : recherche/filtres par rôle et disponibilité affichés, fiches
  collaborateurs réelles avec bouton "Message" fonctionnel.
- **Centre SportVision** : progression XP/grade, chapitres de règlement à lire,
  raccourcis d'accès rapide, tout chargé sans erreur.
- **Mon profil** : formulaire d'identité/coordonnées pré-rempli avec les vraies
  données du compte de test, sauvegarde testée en réel (modification de la bio →
  toast "Profil mis à jour.").
- Aucune erreur console JS ni erreur réseau (4xx/5xx Supabase) résiduelle détectée sur
  l'un des écrans testés, avant comme après correctifs (hors les deux erreurs 400
  volontairement provoquées pour diagnostiquer les bugs #1/#2, résolues par les
  correctifs eux-mêmes).

## Non corrigé

- **Table de correspondance icône/type de kit dupliquée une 3ᵉ fois hors périmètre
  photo** (écran `prod.kanban`, vue "Vue kits" du planning hebdo Admin/Prod) : même
  bug de casse que le point 6 ci-dessus, très probablement présent, non corrigé car
  hors du rôle photo assigné à cette campagne.
- **Bouton "🔴 Jour J" toujours visible sur une mission du jour déjà `médias_complets`**
  (écran "Mes missions" desktop) : la condition d'affichage (`date_prestation===today
  && statut pas dans ['livrée','clôturée','payée']`) n'exclut pas `médias_complets`,
  qui est pourtant un état de fin de mission pour le photographe. Sans risque
  (cliquer dessus ouvre un Mode Jour J qui affiche simplement "✓ Prestation
  terminée"), donc laissé en l'état plutôt que de risquer d'élargir la liste
  d'exclusion sans connaître toutes les implications sur les autres statuts finaux
  possibles.
- **Anomalie de statut observée en cours de campagne, non liée au rôle photo** : une
  prestation de test a été vue passer directement de `prête` à `arrivée_sur_place`
  sans action de ma part (deux transitions légales enchaînées), et une autre créée en
  `planifiée` s'est retrouvée en `équipe_affectée` sans que je l'aie fait avancer —
  cohérent avec la présence d'autres agents de QA travaillant en parallèle sur la même
  base de production partagée (confirmé indépendamment : des comptes de test d'autres
  campagnes, ex. "QA Candidat", "QA Commercial", sont visibles dans l'Annuaire réel).
  Sans impact sur les correctifs ci-dessus, chaque test a été rejoué en resynchronisant
  l'état réel avant d'agir.

## Fichiers modifiés

- `livrables/SportVision-TV/SportVision-OS-Full.html` — tous les correctifs ci-dessus.
  `node --check` validé après chaque lot de modifications.

Aucune migration SQL nécessaire (tous les bugs trouvés étaient côté front/JS ou CSS).
