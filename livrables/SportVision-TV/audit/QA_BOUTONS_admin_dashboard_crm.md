# QA boutons — Admin : Accueil, CRM/Clients, Pipeline, Production hub, Communication

Campagne de test exhaustive par clics réels (Playwright, chromium), sur le déploiement en ligne `https://bc6m3cgdz.sportvision-an.fr/` puis re-test sur le fichier local corrigé. Compte de test réel créé via l'API Admin Supabase (role admin), toutes les données de test nettoyées en fin de campagne (voir en bas).

Périmètre couvert : `admin.dash`, `admin.crmfullcom`, `admin.crmclubplus`, `admin.pipeline`, `admin.prodhub`, `admin.commhub`, `admin.planning`, `admin.calglobal`.

## Bugs trouvés et corrigés

### 1. CRITIQUE — Tous les modals de l'OS étaient inaccessibles à un vrai clic souris/tactile

**Symptôme observé** : en cliquant à la souris (via Playwright, un vrai `mouse.click()` aux coordonnées réelles du bouton — pas un `.click()` DOM programmatique) sur n'importe quel bouton à l'intérieur d'un modal (ex : "Créer le client" dans "+ Nouveau client", "Créer la prestation", "Enregistrer" dans "+ Contact"), rien ne se passait : le modal restait ouvert, aucune requête réseau, aucun toast. Le formulaire semblait fonctionner (les champs se remplissaient), mais la validation finale ne répondait jamais à un clic réel.

**Cause** : le conteneur `#sv-modal` avait `pointer-events:none` figé dans son attribut `style` inline HTML (`<div id="sv-modal" ... style="...;pointer-events:none">`). La règle CSS `#sv-modal.on{pointer-events:auto}` censée réactiver les clics à l'ouverture du modal ne pouvait jamais l'emporter : un style inline prime toujours sur une règle de feuille de style non `!important`, quelle que soit la spécificité du sélecteur. Résultat : `pointer-events:none` restait actif en permanence sur tout l'arbre du modal, empêchant tout clic réel (souris ou tactile) d'atteindre les boutons à l'intérieur — alors qu'un appel JS direct comme `element.click()` fonctionnait car il contourne le hit-testing CSS. C'est très probablement pour cela que les précédents audits automatisés (qui utilisaient ce type d'appel) n'avaient jamais détecté le problème.

**Impact réel** : tous les modals de création/édition/confirmation de tout l'OS (tous rôles confondus, puisque `#sv-modal` est le composant modal partagé unique) étaient inutilisables par un vrai utilisateur avant ce correctif — "+ Nouveau client", "+ Nouvelle prestation", "+ Contact", "Devis rapide", "Confirmation" (`confirmerAction`), etc.

**Correction** : déplacé `pointer-events:none` de l'attribut `style` inline vers la règle de feuille de style `#sv-modal{...}` (état fermé), à côté de `opacity:0;visibility:hidden`. La règle `#sv-modal.on{pointer-events:auto}` (spécificité plus élevée : ID+classe vs ID seul) peut désormais correctement la surclasser à l'ouverture.

Diff exact :
```css
/* avant */
#sv-modal{opacity:0;visibility:hidden;transition:...}
/* + attribut HTML inline : style="...;pointer-events:none" */

/* après */
#sv-modal{opacity:0;visibility:hidden;pointer-events:none;transition:...}
/* attribut HTML inline : pointer-events retiré */
```

**Vérification** : re-testé en local (fichier corrigé) avec de vrais `page.click()` Playwright (actionability + événements souris réels, pas de `force`/`.click()` DOM) :
- Création d'un client test (`creerClient`) → modal se ferme, ligne créée en base (vérifié par requête directe).
- Création d'une prestation liée (`creerPrestation`) → idem, ligne créée et liée au bon client.
- Ajout d'un contact pipeline (`sauvegarderContact`) → idem.
- Avancement de statut pipeline (`avancerPipeline`, hors modal, non affecté par ce bug mais revérifié dans la foulée) → statut passé de prospect → qualifié, toast affiché.

Toutes ces écritures ont été confirmées par requête directe en base puis nettoyées (voir section finale).

## Testé et fonctionnel

- **admin.dash** : chargement sans erreur console/réseau. "+ Club" et "+ Prestation" ouvrent bien leurs modals. Les cartes du bandeau (Clubs actifs, CA, Missions cette semaine, calendrier "Cette semaine") naviguent correctement vers `pre`/`planning`. Bloc "À traiter" avec `modalDetailById` fonctionnel. Objectif "5 clubs partenaires" (slots, barre de progression, funnel) affiché sans erreur. Bloc Activité fonctionnel.
- **admin.crmfullcom** : "+ Nouveau client" ouvre le bon modal ; les 4 onglets (Actifs/Onboarding/À renouveler/Archivés) filtrent correctement ; ouverture de fiche (`_openFicheFullCom`) sur un client réel (Villeneuve 340 Sporting Club) sans erreur ; copie email/téléphone fonctionnelle (toast "Copié").
- **admin.crmclubplus** : les 4 onglets filtrent correctement (vérifié avec de vraies données : 2 clubs en "Essais/onboarding") ; ouverture de fiche (`modalFicheClubPlus`) par clic réel confirmée, et les 6 sous-onglets internes de la fiche (Résumé/Équipes/Demandes/Média/Utilisateurs/Abonnement & gestion) se chargent sans erreur console.
- **admin.pipeline** : "+ Prospect" ouvre le bon modal ; cartes cliquables vers `modalModifierClient` ; actions rapides "+ Contact", "Devis", et l'action d'avancement de statut (`avancerPipeline`) fonctionnelles et vérifiées de bout en bout (voir ci-dessus) ; recherche et filtre par sport présents (non testés par clic — ce sont des `<input>`/`<select>` avec `oninput`/`onchange`, hors périmètre du scan par clic, mais code relu et cohérent).
- **admin.prodhub** : chargement sans erreur ; carte "À valider avant planification" correctement masquée quand aucune prestation n'a le statut `à_valider_production` (aucune donnée dans cet état actuellement, comportement attendu, pas un bug) ; pipeline de production (6 étapes, ex. "À tourner", "En tri"...) navigue vers `pre` avec le bon filtre ; liste "Cette semaine" et "Incidents ouverts" ouvrent `modalDetailById`/`switchView('incidents')` correctement. Écran intégralement en lecture/navigation (aucune mutation directe hors modal), donc pas de risque de double-clic accidentel sur des données réelles.
- **admin.commhub** : callout "Plannings à valider" (badge + `modalPlanningsAValider`) ouvre bien le modal, qui affiche correctement "Aucun planning en attente de validation" (aucune donnée réelle en attente actuellement — testé sans cliquer "Valider"/"Refuser" puisqu'ils agiraient sur de vraies soumissions CM si elles existaient, cf. section Non corrigé) ; pipeline de contenu (4 buckets) affiché sans erreur ; liste "Structures" ouvre `ouvrirFicheClubCommunication` correctement sur un club réel comme sur des clubs de test.
- **admin.planning** : navigation mois précédent/suivant (`planningPrev`/`planningNext`) fonctionnelle ; bascule Calendrier/Liste (`setPlanningView`) fonctionnelle ; "+ Prestation" (global et par jour) ouvre le bon modal pré-rempli avec la date ; clic sur un événement (`modalDetailById`) fonctionnel en vue Calendrier comme en vue Liste ; bouton "Ajouter à Google Agenda" (`addToGcal`) déclenché sans erreur.
- **admin.calglobal** : navigation mois/semaine/agenda (`calGlobalPrev/Next/Today`, `setCalGlobalView`) fonctionnelle sur les 3 modes d'affichage ; légende de types cliquable (`_cgLegendFilter`) ; clic sur un événement (`modalCalGlobalItem`) fonctionnel dans les 3 vues (mois/semaine/agenda) ; conforme à la spec "lecture seule, renvoie vers le module source, pas d'édition inline".
- Scan systématique de tous les gestionnaires `onclick` visibles sur les 8 écrans (recherche de fonctions inexistantes appelées par erreur) : aucun cas trouvé.
- Aucune erreur console JS ni erreur réseau (4xx/5xx Supabase) détectée sur l'un des 8 écrans, avant comme après correctif.

## Non corrigé

- **`modalPlanningsAValider` → boutons "Valider"/"Refuser" internes** : non testés par clic volontairement. Ces boutons mutent réellement le planning hebdomadaire soumis par un CM (`plannings_hebdo.statut`). Aucune donnée réelle n'était en attente au moment du test (liste vide), donc rien à valider/refuser sans données réelles à risquer ; le code (`phTraiter`, `phDemanderMotifRefus`) a été relu et paraît cohérent (PATCH direct + `prompt()` natif pour le motif de refus). Fonctionnalité non exercée en conditions réelles faute de données de test disponibles dans ce module précis — à re-tester si un planning "à valider" test apparaît.
- **Recherche/filtres en `<input>`/`<select>` (`oninput`/`onchange`)** sur pipeline (recherche, sport), calglobal (type/pôle/statut/sport/collaborateur), CRM (recherche, statut) : ces contrôles ne sont pas des `onclick` et n'étaient donc pas dans le périmètre du scan automatisé par clic. Code relu (`renderPipeline`, `applyCalGlobalFilters`, `renderClientsTable`) et logiquement correct, mais pas exercé interactivement faute de temps dans cette passe — à considérer comme "relu, non cliqué".
- **Incident de bord (sans conséquence, documenté pour traçabilité)** : lors de la toute première passe d'exploration automatisée (avant la mise en place du garde-fou de périmètre), un clic sur la carte "Missions cette semaine" du Dashboard a suivi sa navigation légitime vers l'écran `pre` (Prestations, hors périmètre de cet agent), où le scan a continué et cliqué plusieurs boutons "→" d'avancement de statut (`avancerStatutPrestation`) et un "Devis rapide" → une facture (FAC-2026-0017) a été générée comme effet de bord. Vérification faite : les 5 prestations concernées appartenaient toutes à des clients de test QA créés par un autre agent en parallèle (`FC QA Nocturne TEST`, `QA TEST Club Audit Prod`) — **aucune donnée réelle de production n'a été touchée**. La facture de test générée a été supprimée par mesure de propreté. Le script a immédiatement été corrigé avec un garde-fou de périmètre (arrêt et retour automatique si une navigation sort de l'écran testé) et un garde-fou de mutation (aucun clic sur une action qui modifie un enregistrement existant réel, sauf marqueur de test explicite dans la ligne) pour le reste de la campagne. Les statuts pipeline avancés lors des tests sur des clients QA appartenant à d'autres agents (`QA Test FC Alpha`, `QA Test Basket Beta`, `QA TEST Secretariat FC`, `QA Test Rugby Gamma`) n'ont pas été "annulés" — ce sont des fixtures de test partagées entre agents parallèles, pas des données de cet agent à gérer.

## Nettoyage effectué

- Compte de test admin (`qa-admin-test-30aug@sportvision-an.fr`, profil + utilisateur auth) : supprimé.
- Client de test `QA TEST Debug2`, `QA TEST Debug3` (diagnostics du bug modal) : supprimés.
- Client de test `QA TEST AgentFlow` + prestation liée (SV-2026-0097) + contact lié : supprimés.
- Facture de test `FAC-2026-0017` (effet de bord de l'incident documenté ci-dessus) : supprimée.
- Vérifié en base après nettoyage : aucun résidu (recherche `ilike` sur "Debug", "AgentFlow", "FormAgent" → 0 résultat ; profil test → 0 résultat).

## Fichier modifié

`livrables/SportVision-TV/SportVision-OS-Full.html` — 2 lignes changées (règle CSS `#sv-modal` + attribut `style` inline de la balise `#sv-modal`), voir diff dans le commit associé.
