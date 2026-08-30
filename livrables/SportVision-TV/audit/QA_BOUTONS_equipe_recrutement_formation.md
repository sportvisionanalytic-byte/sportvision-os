# QA boutons — Équipe, Recrutement, Formation, Kits, Incidents, Réglages, Intégrations, Documents RH, Messagerie, Centre SportVision

Campagne de test exhaustive, nocturne, autonome. Compte de test admin réel créé via l'API Admin Supabase, connexion réelle sur `https://bc6m3cgdz.sportvision-an.fr/` avec Playwright (Chromium) pour repérer les bugs, corrections appliquées dans le fichier local, retest en local via un serveur HTTP (`python3 -m http.server`) pointant sur le fichier corrigé, avant de committer.

Écrans couverts : `admin.equipeoverview`, `admin.equipehub`, `admin.recrutement`, `admin.form`, `admin.kits`, `admin.incidents`, `admin.docrh`, `admin.set`, `admin.integrations`, `admin.msg`, `admin.centre`, `admin.atraiter`.

## Bugs trouvés et corrigés

### 1. CRITIQUE — Tous les boutons de TOUTES les modales de l'OS étaient morts au clic souris

**Repéré en cliquant** sur "Envoyer l'invitation" dans la modale "Créer un compte collaborateur" (écran Collaborateurs) : le clic Playwright échouait avec "élément intercepté par un autre élément en arrière-plan", exactement le symptôme d'un vrai clic souris qui ne touche jamais le bouton.

**Cause** : le conteneur partagé `#sv-modal` (utilisé par ~200 modales dans tout l'OS) porte un style inline `pointer-events:none` (ligne 614), jamais retiré par `openModal()`. La règle CSS `#sv-modal.on{pointer-events:auto}` ajoutée lors de la passe de polish du 29/08 ne peut pas l'emporter : un style inline a toujours priorité sur une règle de feuille de style non `!important`. Résultat mesuré : `getComputedStyle(modal).pointerEvents` restait `"none"` même modale ouverte (`.on` actif, opacité 1, visible) — un clic souris réel à l'intérieur d'une modale traverse silencieusement vers l'élément en dessous (aucune erreur JS, aucun symptôme visible sans une vraie tentative de clic).

**Portée** : tout l'OS, tous rôles — invitations, création/édition d'entités, confirmations, changements de statut, tout ce qui passe par une modale.

**Correctif** : suppression du `pointer-events:none` inline sur `#sv-modal` (ligne ~614). L'état fermé reste correctement non interactif grâce à `visibility:hidden` déjà présent dans la règle de base — aucune régression sur le fondu d'ouverture/fermeture.

**Vérifié en réel** après correctif : invitation collaborateur envoyée (e-mail réel reçu, compte créé), création de kit/matériel, signalement/clôture d'incident, création/suppression de formation, changement de statut de kit, pipeline recrutement, création de collaborateur depuis une candidature, désactivation de collaborateur, acceptation de chapitre du règlement — tout fonctionne au clic une fois le correctif appliqué.

### 2. Création/édition de kit — 400 Postgres brut si aucun type sélectionné

**Repéré en cliquant** sur "Créer le kit" sans choisir de type : la requête `POST kits` échouait en 400 (`null value in column "type_kit" violates not-null constraint`), le kit n'était jamais créé et l'utilisateur ne voyait qu'un toast d'erreur générique sans savoir quel champ corriger. Même bug en édition (`kitsEditKitSubmit`) si le type était vidé.

**Correctif** : `type_kit` est maintenant marqué obligatoire (`Type *`) avec validation côté client avant l'appel réseau, dans les deux modales (création et édition), avec message explicite ("Le type est obligatoire."). Vérifié : la validation bloque bien la soumission sans type, puis la création aboutit (`201`) une fois le type choisi.

### 3. Vue d'ensemble Équipe — rafraîchissement prématuré après Valider/Refuser un grade (donnée périmée affichée)

**Repéré en cliquant** sur "Valider" une recommandation de grade : le toast "Grade validé et attribué." s'affiche, mais l'item restait visible dans la liste avec ses boutons "Valider"/"Refuser" toujours actifs, alors que la base était déjà à jour (`grade_recommendations.statut='valide'` confirmé en DB).

**Cause** : `centreValiderGrade(...)` est asynchrone (2 PATCH réseau séquentiels : `grade_recommendations` puis `profiles`), mais le rafraîchissement de la liste (`loadEquipeOverview` ou réouverture de la fiche collaborateur) était déclenché par un `setTimeout(...,400)` indépendant de la promesse. Sur toute latence réseau réaliste (plus de 400ms cumulés sur les deux appels), la liste se rechargeait avant la fin réelle du traitement et affichait une recommandation déjà traitée avec ses actions toujours cliquables — risque concret de double-traitement (ex. "Refuser" après coup sur une recommandation déjà validée et déjà appliquée au profil).

**Correctif** : rafraîchissement chaîné sur la résolution de la promesse (`.then(...)`) au lieu d'un délai fixe, dans les deux points d'appel (Vue d'ensemble Équipe et fiche collaborateur individuelle).

**Vérifié en réel** : reproduit le comportement avec une latence réseau simulée (CDP `Network.emulateNetworkConditions`, 600ms) sur une vraie recommandation de test — après correctif, l'item disparaît correctement de la liste une fois le traitement terminé, plus jamais avant.

## Testé et fonctionnel

- **Collaborateurs (`equipehub`)** : invitation d'un nouveau collaborateur (e-mail réel envoyé, compte + profil créés), fiche collaborateur (vue d'ensemble, onglets), "Modifier" (formulaire d'édition), "Désactiver le collaborateur" (confirmation claire, accès coupé, historique conservé — vérifié en DB).
- **Vue d'ensemble Équipe (`equipeoverview`)** : KPI (actifs/onboarding/candidatures/grades en attente), Valider/Refuser une recommandation de grade (grade réellement appliqué au profil en cas de validation), lien "Voir la fiche" pour formations manquantes.
- **Recrutement (`recrutement`)** : pipeline complet testé sur des candidatures fictives — Nouveau → À appeler → Entretien → Retenir → Créer le collaborateur (invitation envoyée, profil pré-rempli depuis la candidature, statut onboarding correct) ; Nouveau → Refuser → Vivier → Réexaminer. CV/Portfolio (liens conditionnels).
- **Centre de formation (`form`)** : onglets Statistiques/Sessions/Certifications/Gérer le catalogue, création d'une formation (formulaire complet), suppression d'une formation custom (`DELETE` confirmé 204), Quiz/Modifier/Activer-Désactiver visibles selon type de formation (builtin vs custom).
- **Kits (`kits`)** : "+ Matériel" (création), "+ Kit" (création, une fois le bug n°2 corrigé), "Voir la fiche" (composition, réservations, incidents liés, actions), "Statut ▾" (changement de statut appliqué et reflété), onglets Kits/Matériels/Contrôles/Incidents/Maintenance.
- **Incidents (`incidents`)** : "+ Signaler" (création avec type/niveau/description/prestation liée), "Clôturer" (confirmation puis clôture effective, compteur mis à jour).
- **Documents RH (`docrh`)** : écran volontairement en lecture seule (upload hors périmètre V1, documenté dans le code) — filtres Manquants/À valider/Expire bientôt/Complets/Tous fonctionnels et cohérents avec les compteurs.
- **Réglages (`set`)** : édition et enregistrement du profil (champs identité/coordonnées), bascule des préférences de notification (persistée en base).
- **Intégrations (`integrations`)** : onglets Connecteurs/Templates email/Communication Hub, ouverture de la modale de configuration d'un connecteur (Google Calendar, Stripe...), consultation des templates e-mail, tableau des envois réels (Communication Hub) avec statuts/tentatives/dates cohérents avec les invitations envoyées pendant les tests.
- **Messagerie (`msg`)** : liste des conversations, envoi d'un message privé (persistance confirmée, affichage temps réel dans le fil).
- **Centre SportVision (`centre`)** : navigation entre sections, acceptation d'un chapitre du règlement (`centre_validations` créé, barre de progression mise à jour), section "Qui contacter ?".
- **À traiter (`atraiter`)** : chargement transverse (17 requêtes parallèles — normal que l'affichage prenne quelques secondes, ce n'est pas un bug), filtres par type, cycle de statut Ouvert → Prendre en charge → (Attente/Résolu/Ignorer) → Rouvrir testé sur un item réel puis restauré à l'identique après test (override supprimé de `atraiter_overrides`, aucune donnée métier source modifiée — cette table ne fait que superposer un statut, jamais les tables sources).

## Non corrigé

- **Double bouton de fermeture (✕) sur les modales utilisant le motif `.mh`/`.mc`** : le conteneur partagé `#sv-modal` a son propre bouton ✕ générique (position absolue, toujours présent), et ~99 modales ajoutent en plus leur propre ✕ dans leur en-tête `.mh`. Les deux fonctionnent (aucun bouton mort), mais ils se chevauchent visuellement dans le coin supérieur droit — cosmétique, pas fonctionnel. Non corrigé par prudence : supprimer l'un des deux systèmes affecte ~99 modales et sort du périmètre strict de cette campagne (bugs fonctionnels trouvés en cliquant). À traiter dans une passe de polish dédiée.
- **Bannière "Connexion perdue — mode hors-ligne" apparue une fois** en tout début de session, sans jamais se reproduire sur ~15 tentatives suivantes avec latence simulée ou non. Le mécanisme (`_checkOffline`, exige 2 échecs consécutifs avant d'alerter) semble correct sur lecture de code ; le seul déclenchement observé coïncide avec une phase où plusieurs scripts de test tournaient en parallèle sur l'environnement partagé (charge/latence externe au code testé). Non reproductible de façon fiable, donc non traité comme bug applicatif confirmé.

## Note sur les données de test

Compte admin de test (`qa.admin.equipe.test@sportvision-an.fr`), collaborateur invité (`qa.invite.test@sportvision-an.fr`), candidatures fictives (`QA CandidatPipeline`, `QA CandidatRefus` et son compte collaborateur dérivé), kit/matériel/incident/formation/message/recommandations de grade de test : tous créés pendant la campagne et **entièrement supprimés en fin de session** (comptes auth, profils, lignes associées, notifications liées) — vérifié par requête de contrôle finale (0 résidu). L'override `atraiter_overrides` posé sur une vraie mission (test du cycle de statut) a également été supprimé, sans aucune modification de la prestation source.

Des données de test préexistantes provenant d'audits précédents (comptes `QA Polish`, `QA TestSec`, `QA CommercialTest`, candidatures "Test Test"/"Verif Redirection", club fictif "QA TEST Club Audit Prod" visible dans les urgences "À traiter", etc.) ont été observées mais **non touchées** — hors périmètre de cette campagne (pas créées par cette session), à nettoyer séparément si souhaité.
