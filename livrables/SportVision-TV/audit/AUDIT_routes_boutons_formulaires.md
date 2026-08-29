# Audit routes / boutons / formulaires — 29/08/2026 (nuit, autonome)

Périmètre : `livrables/SportVision-TV/SportVision-OS-Full.html` (~32 100 lignes). Méthode : extraction
programmatique de `NAV`, `VIEWS`, `MOB_MORE_ITEMS`, `BNAV_ITEMS` + tous les alias dynamiques
(`VIEWS[role+'.'+id]=...`, `forEach` d'aliasing compta→admin/expert_comptable/auditeur), diff exhaustif
NAV↔VIEWS pour les 9 rôles (admin, sec, prod, photo, cm, compta, com, expert_comptable, auditeur), grep
ciblés (TODO/FIXME/HACK/PLACEHOLDER, `onclick="#"`, `console.log`, fonctions onclick non définies,
fonctions définies mais jamais appelées), lecture de code pour chaque candidat avant toute décision.
`node --check` exécuté après chaque lot de modifications (tous OK).

## Corrigé

- **Route morte : `expert_comptable.set` et `auditeur.set`** (`SportVision-OS-Full.html` ~L28027-28039).
  `NAV.expert_comptable` et `NAV.auditeur` listent tous deux `set` ("Paramètres") en dernière entrée,
  mais le `forEach` qui alias `VIEWS[role+'.'+v]=VIEWS['compta.'+v]` pour ces deux rôles listait
  `dash,resultat,rentabilite,budgets,factures,avoirs,depenses,frais,rem,clotures,tva,audit,immobilisations`
  — `set` en était absent. Résultat réel avant correctif : clic sur "Paramètres" pour un compte
  Expert-comptable ou Auditeur affichait `fallbackView()` ("Module en cours de construction") au lieu
  de la page Paramètres (mot de passe, profil…), ces deux rôles ne pouvaient donc jamais y accéder.
  Corrigé en ajoutant `'set'` à la liste du `forEach` (le garde `if(VIEWS['compta.'+v])` existant
  couvre déjà le cas, `compta.set` existe bien).
  → Vérifié : script de diff NAV/MOB_MORE/BNAV × VIEWS (avec tous les alias dynamiques résolus)
  ré-exécuté après correctif = 0 route manquante sur les 9 rôles.

- **Anti double-clic manquant sur 3 confirmations de paiement réelles** (financier, données réelles
  modifiées en base + `logFinancialAudit`) :
  - `comptaConfirmerAcompte(id)` (~L22524) — encaisse un acompte.
  - `comptaConfirmerImpaye(id)` (~L22559) — solde un impayé.
  - `secConfirmerPaye(id)` (~L24603) — même action côté secrétariat.
  Aucune des trois ne désactivait son bouton "Confirmer" pendant l'appel réseau — un double-clic
  pouvait générer 2 lignes `logFinancialAudit` (et pour l'acompte/l'impayé, potentiellement 2 PATCH
  concurrents sur `prestations`). Corrigé avec le même idiome déjà utilisé ailleurs dans le fichier
  (`creerPrestation()` ~L4198, `creerDevis()` ~L15135) : `document.querySelector('#sv-modal .mf .btn.bp')`,
  `if(btn.disabled)return`, réactivation sur chaque chemin d'erreur.

- **`creerClient()` (~L4382, modale "Nouveau client") : aucune protection anti double-clic.** Une
  particularité : le flux anti-doublon (`_chercherDoublonsClient`) réutilise la même fonction en deux
  temps (1er clic = vérification, 2e clic "Créer quand même" = création réelle) — le garde a été
  positionné juste après la levée de `window._fcDoublonConfirme`, donc seul le second appel (la vraie
  création + éventuel contrat associé) est protégé, pas la vérification de doublon. Vérifié que le
  sélecteur `.btn.bp` retombe correctement sur le bon bouton dans les deux scénarios (avec/sans doublon)
  du fait de l'ordre du DOM.

- **`sauvegarderContrat()` (~L28927, modale "Nouveau contrat") : aucune protection anti double-clic
  ET aucun `try/catch`.** Un contrat est un engagement financier (montant_mensuel, signature) — même
  correctif que ci-dessus, avec ajout d'un `try/catch` (absent avant) car sans lui, un vrai échec
  réseau (fetch qui lève une exception, pas juste une erreur PostgREST gérée par `sbErr`) laissait le
  bouton désactivé indéfiniment sans aucun message à l'utilisateur.

Tous les correctifs ci-dessus respectent le refresh-après-mutation déjà en place (`loadComptaAcomptes()`,
`loadComptaImpayes()`, `loadSecRelances()`, `loadContrats()`, `loadViewData()`) — aucun n'en manquait.

## Amélioré

Rien classé "amélioration" séparée cette passe — les correctifs ci-dessus sont tous des corrections de
bugs fonctionnels réels, pas des améliorations cosmétiques.

## À surveiller

- **Anti double-clic non généralisé.** Le pattern `btn.disabled=true` pendant l'appel réseau n'existe
  que sur ~20 fonctions sur les ~478 handlers `onclick` du fichier. Repérés sans être corrigés cette
  nuit (mêmes symptômes que les 5 corrigés ci-dessus, mais moins critiques — statuts non financiers,
  PATCH idempotents) : `signalerIncident()` (~L16222), `creerContenu()` (~L20979, CM),
  `tuteurValiderContenu()` (~L20630), `centreValiderGrade()` (~L30511), `comptaRembourserFrais()`
  (~L22573, bouton de ligne directe, pas de modale). Recommandation : passe dédiée avec un helper
  générique (`withSubmitGuard(fn)`) plutôt que de corriger fonction par fonction, vu le volume.

- **`goError(type)` (~L28574) : infrastructure d'erreur 403/404/500 complète (HTML `#s-error`/`#er-c`
  existe, CSS existe) mais jamais appelée nulle part.** L'app gère actuellement toutes les erreurs par
  `toast()` inline — `goError()` semble être une ébauche de page d'erreur plein écran abandonnée au
  profit du pattern toast. Ni cassé ni dangereux (juste mort), mais si l'intention était de l'utiliser
  pour un vrai 403 (accès refusé par RLS) ou une route totalement invalide, elle n'est aujourd'hui
  déclenchée par rien.

- **`openMobFilter(sections,callback)` et `showMobActionSheet(title,actions)` (~L31385/31407) : bâties
  intégralement (markup, CSS `#mob-filter-panel`/`#mob-action-sheet`, fonctions `toggle`/`close`/`apply`
  toutes utilisées) mais jamais invoquées depuis aucun bouton actuel.** Semble être une infrastructure
  mobile générique construite en avance de besoin (aucune liste actuelle n'a de bouton "Filtrer" qui
  l'utilise). Décision produit — pas touché.

- **Formulaires : aucune validation email/téléphone au-delà de `input type="email"/"tel"` cosmétique.**
  Confirmé par grep (`checkValidity`/`reportValidity` : 0 occurrence dans tout le fichier) — comme
  aucune modale n'utilise un vrai `<form>` avec soumission native, les attributs `type="email"` ne sont
  jamais réellement appliqués. C'est un comportement *uniforme* sur l'ensemble du fichier (pas une
  régression locale), donc pas corrigé conformément à la consigne "ne pas ajouter 30 validations
  nouvelles" — mais à noter si une passe de durcissement des formulaires est planifiée un jour.

## Action externe nécessaire

Aucune — tous les points identifiés étaient traitables avec le contexte disponible dans le fichier.

## Non modifié volontairement

- **Routes NAV `hidden:true` (finance admin/compta, `crm` admin/sec) et items `modal:'modalDemandesClubConnect'`
  (`demandesclub` admin/sec)** : comportement intentionnel et déjà documenté en commentaire dans le
  fichier (regroupement Finances du 22-28/08, mécanisme "hidden mais fonctionnel"). Vérifié que
  `VIEWS[...]` existe bien pour tous via les alias `compta.*` → aucune n'est cassée, juste hors sidebar.

- **`cm.pilotage` / `cm.analytics`** : semblaient orphelins de `NAV.cm` au premier passage du diff, mais
  sont en réalité injectés dynamiquement par `renderSidebarNav()` (~L27417-27422) pour les CM avec
  `cm_niveau_autonomie==='responsable'` — pas un bug, juste absents du tableau `NAV` statique par
  construction (documenté en commentaire dans le fichier lui-même).

- **`com.connectcomptes`, `prod.kanban`, `prod.post`, `sec.cmagency`** : VIEWS existantes mais plus
  référencées par aucun NAV/MOB_MORE/BNAV — chacune correspond à un retrait de nav documenté en
  commentaire (refontes Commercial/Production/Secrétariat du 28-29/08, "retiré... vues et fonctions
  conservées, seul le nav change"). Suppression du code délibérément non faite — c'est exactement le
  pattern que le reste du fichier applique déjà partout (garder la vue, retirer l'entrée de menu).

- **Bloc "Compatibilité backward" (~L13806-13812, `modalChangerStatutKit`, `appliquerStatutKit`,
  `modalModifierKit`, `modifierKit`, `supprimerKit`)** : 5 fonctions wrapper vers les vraies fonctions
  `kits*` actuelles, 0 appelant trouvé pour aucune des 5. Le commentaire du bloc indique explicitement
  qu'elles sont gardées en filet de sécurité pour d'anciens `onclick` potentiellement encore en cache
  navigateur — suppression non faite, conforme à l'intention documentée.

- **`confirmerSignatureDoc()` (~L14337)** : ne fait rien d'utile (juste un toast d'erreur), mais c'est
  volontaire et très bien documenté en commentaire — bouton retiré de l'UI le 08/08, fonction
  "neutralisée au lieu d'être supprimée" comme filet de sécurité pour un ancien `onclick` en cache.
  Décision déjà prise par Fouka (signature papier = passage exceptionnel par SQL Editor uniquement).

- **`loadGradesUnused_deprecated()` (~L29244)** : nom explicite, déjà signalé comme mort par un
  précédent passage. Pas supprimé (pas de gain réel, éviter tout risque une nuit sans supervision) mais
  confirmé sans appelant.

- **`saveFormProg(uid,data)` (~L17270)** : setter jamais appelé — l'état `_formProgCache` est en réalité
  toujours muté directement ailleurs (`_formProgCache[id]=...`, ~L18644/18711/18818). Dead code réel et
  sans risque à supprimer, mais laissé en l'état par prudence (zéro bénéfice fonctionnel à le retirer).

- **Aucun `onclick="#"`, aucun `TODO`/`FIXME`/`HACK`/`PLACEHOLDER`, aucun `console.log` de debug,
  aucune fonction appelée par un `onclick` mais non définie** trouvés dans tout le fichier (vérifié par
  grep exhaustif + cross-check programmatique des ~478 appels `onclick` contre toutes les définitions
  de fonctions). Les seuls faux positifs de ce dernier grep étaient des méthodes natives (`.click()`,
  `.close()`, `JSON.parse`, `localStorage.getItem`, etc.), pas des fonctions custom.
