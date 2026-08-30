# QA boutons — Finance / Comptabilité

Campagne de QA exhaustive nocturne (29-30/08/2026), périmètre : tous les écrans sous
`admin.fin*` et `compta.*` (dashboards `compta.dash`/`expert_comptable.dash`, résultat,
revenus, dépenses, équipe/paiements, factures, impayés, avoirs, encaissements, acomptes,
rentabilité, budgets, commissions, immobilisations, clôtures, TVA, FEC, journal d'audit,
rapprochement bancaire, export comptable), pour les 4 rôles `admin`/`compta`/
`expert_comptable`/`auditeur`.

Méthode : 4 comptes de test réels créés via l'API Admin Supabase (un par rôle), Playwright
(chromium) contre `https://bc6m3cgdz.sportvision-an.fr/` pour cliquer réellement chaque
bouton/filtre/onglet de chaque écran, formulaires soumis avec des données réalistes
(libellés préfixés `QA-TEST-...` pour les repérer), vérification directe en base après
chaque action, puis nettoyage complet. Aucune action de mutation n'a été déclenchée sur une
ligne de données RÉELLE préexistante (factures, dépenses, clients, prestations Fouka) — les
boutons d'action par ligne rendus dans un conteneur de données dynamiques (`*-real`) n'ont
jamais été cliqués automatiquement, seulement sur des lignes que j'ai moi-même créées pour
le test.

## Bugs trouvés et corrigés

### 1. CRITIQUE — `expert_comptable` et `auditeur` ne pouvaient jamais se connecter
En créant un compte de test réel `role='expert_comptable'` et un `role='auditeur'` et en
testant une vraie connexion, l'app affichait systématiquement « Profil introuvable.
Contactez l'administrateur. » juste après une authentification Supabase Auth réussie —
login bloqué à 100%, pour n'importe quel compte de ces deux rôles, alors qu'ils sont
pleinement implémentés côté app (menu dédié, dashboard `tplExpertComptableDash`, écrans
Finance en lecture seule).

Cause : `profiles` n'avait qu'une seule policy RLS `SELECT` (« Staff lecture annuaire »),
gardée par `is_staff()` — et `is_staff()` (fonction définie ailleurs, hors périmètre
Finance, pour distinguer le "staff pur" du "staff ayant aussi un compte personnel
Connect/Club+/joueur") ne liste que
`('admin','sec','prod','photo','cm','compta','com')`, sans `'expert_comptable'` ni
`'auditeur'`. Le `fetch` juste après connexion (`profiles?id=eq.<uid>&select=role,...`,
`doLogin()`) revenait donc avec un tableau **vide** (HTTP 200, RLS bloque silencieusement,
pas une erreur réseau) — l'app concluait à tort que le profil n'existait pas.

Vérifié que toutes les AUTRES tables Finance (`expenses`, `vendors`, `avoirs`,
`commissions`, `bank_transactions`, `tax_reserves`, `accounting_periods`,
`forecast_scenarios`, `fec_exports`, `pcg_mapping`, `financial_audit_log`, `factures`,
`materiels`) ont déjà des policies RLS dédiées qui incluent correctement
`expert_comptable`/`auditeur` — le trou de sécurité était strictement localisé à la lecture
de son propre profil, nécessaire pour boucler la connexion.

**Corrigé** par une migration additive et non destructive (n'importe quel rôle doit pouvoir
lire SA PROPRE ligne `profiles`, ce n'est pas un privilège "staff") :
`livrables/SportVision-TV/migration-audit-qa-finance-fix-profiles-self-select-expert-comptable.sql`
— ajoute une policy `SELECT` `auth.uid() = id` (exactement le même principe que la policy
`UPDATE` « Mise à jour profil personnel » déjà en prod), sans toucher à `is_staff()` ni à la
policy existante. **Appliquée et vérifiée en réel** : après la migration, les deux comptes
de test se connectent, chargent leur dashboard et tous leurs écrans Finance sans aucune
erreur console (testé écran par écran, ~30 écrans par rôle).

### 2. Rapprochement bancaire — suggestions sans aucun rapport présentées comme actionnables
En important un CSV bancaire de test avec un montant délibérément aberrant
(987 654,32 €, sans rapport avec aucune facture/dépense réelle) et en ouvrant « Rapprocher »
sur cette transaction, l'écran a affiché une VRAIE facture existante (180,00 €, score 0 —
aucune correspondance sur le montant, la référence, le client ni la date) avec un bouton
« Rapprocher » tout aussi cliquable qu'une vraie suggestion pertinente. Cause : la RPC
`fin_suggerer_rapprochements()` renvoie jusqu'à 5 candidats « les plus proches » triés par
score, sans filtrer un score minimum côté SQL — pour une transaction qui ne correspond
réellement à rien, elle renvoie quand même les factures/dépenses les moins mauvaises du lot,
même à score 0. Risque concret : un comptable pressé pourrait rapprocher (donc marquer
payée) une facture totalement sans rapport avec la transaction bancaire réelle.

**Corrigé côté client** (`modalRapprocherTransaction`, ~ligne 26527) : les suggestions à
score 0 sont désormais filtrées avant affichage — si aucune suggestion avec un signal réel
(montant/référence/client/date) ne subsiste, l'écran affiche le message « Aucune
correspondance nette trouvée » (comportement déjà prévu pour le cas où la RPC ne renvoie
rien du tout). Choix délibéré de ne pas toucher la RPC SQL elle-même (le calcul de score
reste strictement identique, seul l'affichage change) pour rester dans le périmètre
« bug d'interaction/UI » sans toucher un calcul financier.

### 3. Journal d'audit — libellés manquants pour 2 actions
`AUDIT_ACTION_LABELS` ne connaissait pas les actions `import_csv_bancaire` (écrite par
`_finConfirmerImportCSV`) ni `rapprochement_bancaire` (écrite par la RPC
`fin_rapprocher_transaction`) — repéré en importatant un CSV de test et en consultant le
Journal d'audit, où l'action s'affichait sous son nom technique brut au lieu d'un libellé
lisible. Ajouté : `Import CSV bancaire` / `Rapprochement bancaire`.

## Testé et fonctionnel

- **Connexion** : admin, compta, expert_comptable (après fix), auditeur (après fix).
- **Chargement sans erreur console** : tous les écrans du périmètre pour les 4 rôles
  (~30-50 écrans par rôle selon la nav du rôle) — `resultat`, `rentabilite`, `commissions`,
  `immobilisations`, `budgets`, `tva`, `rapprochement`, `factures`, `acomptes`, `impayes`,
  `avoirs`, `encaissements`, `cotisations`, `documents`, `depenses`, `frais`, `paiements`,
  `rem`, `clotures`, `export`, `fec`, `audit`, `dash`/`expert_comptable.dash`, `finrevenus`,
  `findepenses`, `finequipe`, `finrapports`.
- **Aliasing de navigation admin → compta** (`admin.resultat`, `admin.factures`, etc.) :
  vérifié fonctionner correctement via `VIEWS['admin.'+v]=VIEWS['compta.'+v]` (ligne ~28262)
  — malgré l'apparence de code mort en lecture rapide, ce n'est pas un bug.
- **Tous les filtres** (statut/catégorie/source/type) sur chaque écran : cliqués, mettent
  à jour l'affichage et le style du bouton actif sans erreur.
- **Modales de création** ouvertes et vérifiées avec les bons champs pré-remplis :
  Nouvelle dépense, Nouveau fournisseur, Nouvelle commission, Nouvel avoir, Réglages coûts
  indirects, Importer un CSV bancaire, Mapping des comptes (PCG), Modifier un scénario
  budgétaire (x4).
- **Créations réelles testées avec données QA, vérifiées en base puis supprimées** :
  - Dépense : `montant_ttc` calculé correctement (123,45 € HT + 20 % → 148,14 € TTC).
  - Fournisseur : création simple, apparaît dans la liste.
  - Avoir sans prestation liée (geste commercial) : `montant_ttc` correct (1,00 € HT →
    1,20 € TTC), numérotation séquentielle `AVO-2026-0001` correcte.
  - Commission : calcul correct (base 10 € × taux 1 % = 0,10 €), cycle complet
    `calculée → validée → payée` testé sur cette ligne de test, boutons dynamiques
    corrects à chaque étape.
  - Import CSV bancaire : parsing (dates FR/ISO, virgule/point décimal, délimiteur `,`/`;`)
    correct, upsert avec déduplication (`on_conflict=provider,provider_account_id,
    provider_transaction_id`) confirmé, transaction visible en « À traiter ».
  - Rapprochement bancaire → « Ignorer cette transaction » : statut correctement mis à jour
    (`a_traiter` → `ignoree`) en base.
- **Exports CSV** : tous les types cliqués sans erreur (`factures`, `ca-mensuel`,
  `remunerations`, `clients`, `prestations`, `rentabilite-missions`,
  `budget-previsionnel`) — déclenchement du téléchargement confirmé.
- **Aperçus PDF** (`imprimerFacture`, `imprimerDevis`, `genererContratPDF`) : confirmés en
  lecture seule par le code (commentaire explicite : ne créent jamais de facture/numéro
  séquentiel) et par le clic réel (fenêtre popup, aucune écriture en base).
- **Envoi devis/facture par email** (`envoyerDevisParEmail`, `envoyerFactureParEmail`) :
  ouverture de la modale confirmée avec contenu pré-rempli correct (destinataire, montant,
  message par défaut) ; l'envoi effectif (bouton "Envoyer" dans la modale) n'a volontairement
  pas été déclenché pour ne pas envoyer un vrai email à un vrai client.
- **Immobilisations** : confirmé être un miroir en lecture seule du module Kits/Matériel
  (`materiels.valeur`/`date_achat`, amortissement linéaire calculé côté client) — l'absence
  de bouton "+ Ajouter" n'est pas un oubli, la création se fait dans le module Matériel
  (hors périmètre de cet audit).
- **RBAC de l'UI** : les boutons de création/réglages réservés à `admin`/`compta`
  (`+ Commission`, `⚙ Réglages coûts indirects`, `⚙ Mapping des comptes`, `+ Fournisseur`,
  `+ Nouvelle dépense`) sont bien absents pour `expert_comptable` et `auditeur` — le module
  est réellement lecture seule de bout en bout pour ces deux rôles, cohérent avec le
  commentaire de conception (« RLS empêche toute écriture, les boutons de création sont
  eux-mêmes masqués »).
- **Anti-double-clic** sur les actions financières sensibles (`comptaConfirmerAcompte`,
  `comptaMarquerPayeImpaye`) déjà en place (référence à l'audit du 29/08), non retouché.

## Non corrigé

### Dépenses (`expenses.statut`) : aucun chemin ne mène jamais à `'comptabilisée'`
`expenses.statut` a 4 valeurs (`prevue`/`engagee`/`payee`/`comptabilisee`), toutes lues et
filtrées à de nombreux endroits (dashboard, résultat, rentabilité, FEC...), mais **aucun**
code — ni JS ni SQL/RPC — n'écrit jamais `statut='comptabilisee'` sur une dépense. La seule
transition existante est `engagee → payee`, et uniquement via le rapprochement bancaire
(RPC `fin_rapprocher_transaction`, quand une transaction bancaire est rapprochée d'une
dépense) — il n'y a aucun bouton "marquer comme comptabilisée" manuel nulle part dans
l'écran Dépenses (ni `compta.depenses`, ni `admin.findepenses`). C'est peut-être une étape
de validation experte-comptable jamais implémentée (le nom suggère une validation finale
distincte du simple paiement), ou un état mort dans l'enum. Je ne l'ai pas ajouté moi-même :
décider du sens exact de "comptabilisée" (qui la déclenche, à quel moment du cycle) est une
décision produit/métier, pas un bug d'interaction évident à corriger à l'aveugle.

### Édition des scénarios budgétaires et Mapping PCG : vérifiés par lecture de code, non exercés en écriture réelle
`sauvegarderScenario()` (Budgets → Modifier un scénario) et `sauvegarderMappingPCG()`
(FEC → Mapping des comptes) font un `PATCH` direct sur des tables de configuration globales
réelles (`forecast_scenarios`, `pcg_mapping`) — pas des enregistrements ponctuels que je
peux créer/supprimer proprement pour le test. Le code est correct à la lecture (mêmes
champs que dans le formulaire, pas de risque de calcul erroné), mais je n'ai pas cliqué
« Enregistrer » sur ces deux formulaires en conditions réelles pour ne pas modifier les
hypothèses de croissance réelles de Fouka ou le mapping comptable réel sans sa demande.

### Clôture mensuelle : vérifiée par lecture de code, non exécutée sur un mois réel
`cloturerPeriode()`/`reouvrirPeriode()` ont un `confirm()`, une logique idempotente
(`upsert on_conflict`) et sont réversibles (« Rouvrir ») — code cohérent et déjà audité par
une session précédente. Je n'ai pas cliqué « Clôturer » sur un vrai mois (même réversible)
pour éviter de perturber un usage réel en cours de l'OS cette nuit par une autre session
parallèle (constatée dans le journal d'audit : plusieurs actions concurrentes d'un autre
agent pendant mes tests).

### Export FEC : bouton désactivé en pratique, vérifié par lecture de code uniquement
`genererExportFEC()` exige une période déjà clôturée (`accounting_periods.statut=
'cloturee'`) — actuellement 0 mois clôturé, donc le bouton « Générer l'export FEC » reste
désactivé (`disabled`) en conditions réelles. Logique vérifiée par lecture (colonnes FEC
18 champs conformes, montants équilibrés débit/crédit par écriture) mais non exécutée faute
de période clôturée disponible pour un vrai test.

### « Générer les échéances dues » (dépenses récurrentes) : non cliqué en production
`genererDepensesRecurrentes()` (bouton `↻` sur l'écran Dépenses) appelle la RPC
`fin_generer_depenses_recurrentes`, qui crée de VRAIES lignes `expenses` pour toute
récurrence réellement due — non cliqué pendant cette campagne pour ne pas produire d'écriture
financière réelle non sollicitée. RPC vérifiée exister (migration-finance-refonte-28-08.sql)
et correctement protégée côté serveur (réservée à `admin`/`compta` via `auth.uid()`).

## Notes

- Pendant les tests, le journal d'audit financier montrait des entrées concurrentes d'un
  autre agent (acteurs `424f5f5b...`/`3725efde...`, tables `prestations`/
  `prestations_equipe`) — confirmant qu'une autre session travaillait en parallèle sur la
  même base cette nuit. Je n'ai touché à aucune de ces lignes.
- Comptes de test créés puis intégralement supprimés (auth + profils) :
  `qa-finance-admin-test@sportvision-an.fr`, `qa-finance-compta-test@sportvision-an.fr`,
  `qa-finance-ec-test@sportvision-an.fr`, `qa-finance-aud-test@sportvision-an.fr`. Toutes
  les écritures financières de test (dépense, fournisseur, avoir, commission, transaction
  bancaire importée, provisions TVA générées par inadvertance en testant le bouton
  « Provisionner ce mois ») ainsi que les entrées associées du journal d'audit et des
  notifications/document_events qui bloquaient la suppression des comptes ont été supprimées
  et vérifiées absentes en base à la fin de la session.
