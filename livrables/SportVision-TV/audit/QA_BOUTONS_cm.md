# QA boutons — rôle Community Manager (cm), tous niveaux — 30/08/2026

Campagne de test exhaustive, en cliquant réellement sur chaque écran/bouton, avec deux
vrais comptes de test :
- `qa.cm.junior.30082026@sportvision-qatest.fr` — `cm_niveau_autonomie='junior'`
- `qa.cm.responsable.30082026@sportvision-qatest.fr` — `cm_niveau_autonomie='responsable'` (tuteur du junior)

Données de test créées et utilisées : tutorat (`cm_tutorships`), une structure
(`clients`) "QA TEST Structure CM", trois contenus (dont deux à `a_valider_tuteur`
pour tester le vrai clic de validation/correction), un club Club+ de test ("QA TEST
Club") sans fiche client liée + une demande dessus (pour tester la "File Club+
générale"). Playwright/chromium contre `https://bc6m3cgdz.sportvision-an.fr/` pour le
repérage, puis contre une copie locale servie en HTTP pour vérifier les correctifs.
Toutes les données de test ont été supprimées en fin de campagne et leur absence
vérifiée (comptes auth, profils, tutorat, structure, contenus, club, demande — tout
confirmé vide en re-requêtant après suppression).

## Bugs trouvés et corrigés

### 1. [CRITIQUE] "File Club+ générale" invisible pour tout CM — trou RLS, pas un bug de bouton
La fonctionnalité "prise en charge d'une demande Club+ du pool" (spec Refonte CM
§30-31, écran Demandes) était **morte à 100 %** pour tout club Club+ pas encore lié à
une fiche client (le cas même visé par "file générale, personne n'est encore
affecté" — typiquement un club qui vient de s'inscrire en self-service).

Repéré en clic réel : demande de test créée sur un club sans `portail_client_id`,
écran Demandes ouvert en CM → affichait "Aucune demande reçue pour l'instant.", la
section "File Club+ générale" n'apparaissait même pas, alors que `loadCmDemandes()`
est bien câblée pour la construire.

Cause racine (RLS-sur-RLS) : la policy `creq_staff_select` (posée par
`migration-cm-club-link-fix.sql`) exige `c.portail_client_id is not null` pour qu'un
CM puisse ne serait-ce que **lire** une ligne `club_requests`. Un premier correctif
naïf (ajouter une clause `exists (select ... from clubs where portail_client_id is
null)` directement dans la policy) semblait correct sur le papier mais **ne changeait
rien en réel** : cette sous-requête sur `clubs` reste soumise à la policy RLS de
`clubs` elle-même (`clubs_cm_select`), qui a exactement la même exigence — la
sous-requête ne voit donc jamais la ligne "pool" qu'elle cherche à vérifier. Corrigé
avec une fonction `SECURITY DEFINER` (`club_request_is_pool()`), même remède que
`contenus_visible_par_cm()` déjà dans le code pour la même raison.

Second trou de la même famille : une fois une demande de pool prise en charge
(`claim_club_request` met `taken_by`), l'écran la faisait passer côté "Mes demandes"
avec des boutons "étape suivante" appelant `staff_update_club_request_status()` — qui
avait la même garde `portail_client_id is not null`. Le CM qui vient de prendre en
charge une demande de pool ne pouvait alors **plus jamais** la faire avancer ("Accès
refusé." systématique).

**Corrigé** (`livrables/SportVision-TV/migration-qa-cm-30-08-clubplus-pool-visibilite.sql`,
appliquée en réel sur la base de production via l'API Management Supabase, testée
avant/après avec le JWT réel du compte de test) :
- nouvelle fonction `club_request_is_pool(p_club_id)` (SECURITY DEFINER)
- `creq_staff_select` (club_requests) : ajoute la visibilité pool à tout CM en poste
- `clubs_cm_select` (clubs) : même ajout, sinon la ligne pool était visible mais le
  nom du club restait vide (embed PostgREST `clubs(nom,...)` filtré à son tour)
- `staff_update_club_request_status()` : autorise en plus le titulaire actuel
  (`taken_by = auth.uid()`) à faire avancer sa propre demande

Aucune règle métier changée : qui a le droit de **prendre en charge** reste
entièrement dans `claim_club_request()` (`cm_pool_clubplus_general` ou
`responsable`), inchangé. Testé en réel de bout en bout : compte junior (hors pool)
voit la demande mais se prend un message d'erreur clair en cliquant "Prendre en
charge" ("Seuls les membres du pool Club+ general ou le Responsable CM peuvent...") ;
compte responsable la prend en charge (toast "Demande prise en charge."), puis la
fait avancer jusqu'à "Prête à créer" (toast "Demande mise à jour.") — sans le
correctif, cette seconde étape échouait avec "Accès refusé."

### 2. Titre de page vide sur "Pilotage CM" / "Performances" pour un Responsable CM
`switchView()` cherchait le libellé de la page dans `NAV[S.role]` (le tableau
**statique**), qui ne contient jamais `pilotage`/`analytics` — ces deux entrées ne
sont ajoutées qu'au rendu de la sidebar (`renderSidebarNav()`, uniquement si
`cm_niveau_autonomie==='responsable'`). Résultat : en cliquant sur "Pilotage CM" ou
"Performances" dans la sidebar (qui, elle, s'affichait très bien et se surlignait
correctement), le fil d'ariane à côté de "SportVision OS /" restait vide au lieu
d'afficher le titre — repéré en cliquant vraiment dessus avec le compte responsable
de test, capture d'écran à l'appui.

**Corrigé** (`SportVision-OS-Full.html`) : factorisation de la logique d'augmentation
de nav (avant dupliquée uniquement dans `renderSidebarNav()`) dans une fonction
partagée `_navForRole(role)`, utilisée par `renderSidebarNav()` **et** par
`switchView()` pour le titre de page. Revérifié après correctif (local) :
`switchView('pilotage')` → titre "Pilotage CM" ; `switchView('analytics')` → titre
"Performances" ; `switchView('dash')` → toujours "Accueil" (pas de régression).

## Testé et fonctionnel

- **Connexion + sidebar** : junior voit les 9 écrans standards (Accueil, Mes
  structures, Planning, Demandes, Contenus, Mes revenus, Formation, Messagerie, Mon
  profil), sans "Pilotage CM" ni "Performances". Responsable voit en plus ces deux
  écrans, insérés au bon endroit (juste après Accueil, juste après Contenus).
- **Fiche Structure (workspace client)** : les 5 accès rapides testés un par un en
  cliquant réellement dessus (`modalFicheStructureCm`) — Planning, Contenus,
  Demandes, Médiathèque, Performances redirigent chacun vers le bon écran
  (`S.view` vérifié après chaque clic).
- **Workflow Junior → Tuteur, testé en boucle complète** :
  - Junior crée un contenu (modale "Nouveau contenu", tous les champs) → statut
    "Idée / à créer", bouton "→ Soumettre au tuteur".
  - Junior soumet → statut "À valider (tuteur)", plus aucune action pour le junior
    lui-même (conforme au trigger serveur `protect_junior_content_publication`).
  - Tuteur (responsable) clique "✓ Valider" → toast "Contenu validé.", statut "Prêt",
    passe au flux standard ("→ Programmer").
  - Tuteur clique "Corriger" sur un second contenu, saisit un commentaire, envoie →
    toast "Correction demandée.", statut "Corrections" avec le commentaire affiché en
    rouge sous le titre, bouton "→ Reprendre en brouillon".
  - Junior reprend en brouillon puis resoumet → repasse bien en "À valider (tuteur)".
- **Demandes — "Mes demandes" + "File Club+ générale"** (après correctif RLS
  ci-dessus) : KPIs (Nouvelles/En traitement/Urgentes) corrects, ligne pool avec nom
  de club, bouton "Prendre en charge" → refus propre pour un CM hors pool, succès
  pour le responsable, puis avancement de statut ("Prête à créer") fonctionnel.
- **Planning** : bascule Production ↔ Éditorial fonctionnelle, KPIs, grille
  hebdomadaire (7 jours) avec bouton "+" par jour, planning mensuel avec sélecteur de
  mois et message d'absence de client Full Communication correct pour un compte sans
  contrat Full Com.
- **Rapports clients** : sélection client + mois, "Générer" produit un vrai rapport
  (KPIs, répartition par plateforme, publications du mois, en cours/à venir),
  "Copier le résumé" (presse-papier confirmé), "Marquer prêt" (statut
  brouillon → prêt persistant en base, historique mis à jour), bouton suivant
  "Marquer envoyé" apparaît bien après.
- **Media Bank** : filtres (sport/catégorie/recherche), état vide correct pour la
  structure de test qui n'a aucun média en banque.
- **Vidéos à valider / Publications** : états vides corrects et cohérents avec
  l'absence de contrat Full Communication / de contenu publié sur la structure de
  test.
- **Mes revenus, Formation (5 onglets), Messagerie, Mon profil** : chargement sans
  erreur console/page, aucun bouton mort repéré.
- **Non-régression vérifiée sur données réelles** : le vrai club Villeneuve 340
  Sporting Club (lié à une fiche client avec CM assigné) tombe dans la branche RLS
  inchangée par le correctif — revérifié par requête directe post-migration.

## Non corrigé

- Bannière "📶 Connexion perdue — mode hors-ligne" apparue de façon intermittente et
  non reproductible de manière fiable pendant la campagne (parfois présente dès le
  chargement, parfois absente sur un run identique). Cause probable : latence/aléa
  réseau ponctuel dans l'environnement de test (curl direct et plusieurs runs
  contrôlés confirment que le ping `_checkOffline()` répond 200 normalement). Le
  code applique déjà une garde anti-faux-positif (2 échecs consécutifs requis). Pas
  de correction appliquée faute de cause reproductible identifiée avec certitude —
  à surveiller si le signalement revient en usage réel.
- Écrans "contextuels" hors NAV permanente (Media Bank, Vidéos à valider,
  Publications, Rapports clients, Performances/Analytics pour un CM non-responsable)
  affichent un fil d'ariane vide à côté de "SportVision OS /" quand on y accède —
  comportement **cohérent et volontaire** de l'architecture ("ce ne sont plus des
  pages permanentes"), pas retouché : seul le cas Pilotage/Performances pour un
  Responsable (où l'écran EST une entrée de sidebar permanente) a été traité, car
  c'est le seul qui constitue une régression visible entre sidebar et fil d'ariane.
- Plusieurs jeux de données de test résiduels d'autres campagnes QA en cours cette
  nuit (rôles Production/Secrétariat/Commercial), repérés en passant : clients
  "QA TEST Club Audit Prod", "QA Test Rugby Gamma", "QA Test Basket Beta",
  "QA TEST Secretariat FC", "QA Test FC Alpha", "FC QA Nocturne TEST", des comptes
  "ExpertComptable QATest"/"FinanceAdmin QATest"/"FinanceCompta QATest"/"Auditeur
  QATest" dans l'annuaire Messagerie, et plusieurs structures "Non affecté" dans
  Pilotage CM. Non touchés : créés par d'autres agents (`created_by` différent),
  potentiellement encore utilisés par leurs campagnes respectives — à ces agents de
  nettoyer leurs propres données en fin de mission.

## Fichiers modifiés

- `livrables/SportVision-TV/SportVision-OS-Full.html` — fonction `_navForRole()`
  factorisée, utilisée par `renderSidebarNav()` et `switchView()`.
- `livrables/SportVision-TV/migration-qa-cm-30-08-clubplus-pool-visibilite.sql` —
  nouvelle migration (idempotente), **déjà appliquée en réel** sur la base de
  production via l'API Management Supabase et vérifiée avant/après avec un JWT de
  test réel.
