# SportVision OS — URLs de démonstration pour audit

**Base** : `https://sportvision-os.netlify.app/`

## Mise à jour du 20/08 — routes `/demo/<module>` directes et crawlables

Suite à l'audit externe (ChatGPT) reçu sur la V1 (`?demo=1&role=&view=`) : le retour explicite était que ce format n'est pas assez granulaire/crawlable — une seule page shell derrière une query string, pas d'URL stable par module comme sur Connect/Club+.

**Ce qui a changé** : chaque module réel a maintenant sa propre URL, ouvrable directement dans un nouvel onglet, sans dépendre du tableau de bord ni d'un état JS préalable. Le SPA reste un SPA à état interne (`S.role`/`S.view`, pas de vrai routeur) — la nouveauté est une couche qui lit `location.pathname` au chargement et bascule directement sur le bon rôle+écran, avec redirect Netlify (`status=200`, rewrite) pour que le refresh d'une URL `/demo/...` ne renvoie jamais un 404. Toutes les routes `/demo*` portent une balise `<meta name="robots" content="noindex,nofollow">` (pas d'indexation Google).

**Page d'accueil** : [`https://sportvision-os.netlify.app/demo`](https://sportvision-os.netlify.app/demo) — liste cliquable de tous les modules ci-dessous.

### Table exhaustive — statut par route (livrable demandé : ROUTE / MODULE / STATUT)

| Route demo | Module réel (rôle.écran) | Statut |
|---|---|---|
| `/demo/dashboard` | admin.dash | REAL UI + DEMO DATA |
| `/demo/demandes` | sec.demandes | REAL UI + DEMO DATA |
| `/demo/prestations` | admin.pre | REAL UI + DEMO DATA |
| `/demo/production` | prod.pre | REAL UI + DEMO DATA |
| `/demo/missions` | prod.equipes | REAL UI + DEMO DATA |
| `/demo/planning` | admin.planning | REAL UI + DEMO DATA |
| `/demo/clients` | admin.crm | REAL UI + DEMO DATA |
| `/demo/structures` | admin.crm (alias — même écran, pas de notion "structure" séparée) | REAL UI + DEMO DATA |
| `/demo/equipe` | admin.col | REAL UI + DEMO DATA |
| `/demo/operateurs` | admin.col (alias) | REAL UI + DEMO DATA |
| `/demo/recrutement` | — | **NOT IMPLEMENTED** (aucun vivier candidats dans l'OS) |
| `/demo/remunerations` | admin.rem | REAL UI + DEMO DATA |
| `/demo/materiel` | admin.kits | REAL UI + DEMO DATA |
| `/demo/contenus` | cm.contenus | REAL UI + DEMO DATA (partiel, voir pack) |
| `/demo/livrables` | prod.livr | PARTIAL (données médias/livrables peu peuplées) |
| `/demo/finance` | admin.fin | REAL UI + DEMO DATA (complétée le 20/08) |
| `/demo/factures` | admin.factures | REAL UI + DEMO DATA — **écran alimenté par `prestations.statut_financier`, pas par une table `factures` dédiée** (voir incohérence notée dans le pack) |
| `/demo/devis` | admin.devis | REAL UI + DEMO DATA |
| `/demo/paiements` | admin.paiements | REAL UI + DEMO DATA (paiements **équipe**, pas paiement client) |
| `/demo/charges` | admin.depenses | REAL UI + DEMO DATA (dépenses fixes/variables ajoutées le 20/08) |
| `/demo/previsionnel` | admin.budgets | REAL UI + DEMO DATA (alias — pas de moteur de scénarios séparé) |
| `/demo/rapprochement` | admin.rapprochement | PARTIAL — **aucune intégration bancaire (Qonto/Revolut) trouvée dans le code**, l'écran compare des données internes (`prestations`), pas de vrai rapprochement banque↔compta confirmé |
| `/demo/contrats` | admin.contrats | REAL UI + DEMO DATA |
| `/demo/abonnements` | sec.abonnements | REAL UI (peu de données démo) |
| `/demo/clubplus` | admin.connectcomptes | REAL UI + DEMO DATA |
| `/demo/clubplus/demandes` | admin.demandesclub (modale) | REAL UI + DEMO DATA |
| `/demo/clubplus/ouvertures` | — | **NOT IMPLEMENTED** (action dans `/demo/clubplus`, pas de page séparée) |
| `/demo/clubplus/credits` | — | **NOT IMPLEMENTED** (solde visible dans la fiche compte de `/demo/clubplus`, pas de ledger séparé) |
| `/demo/clubplus/affiliations` | — | **NOT IMPLEMENTED** (aucun écran OS ne liste les affiliations club↔joueur) |
| `/demo/connect` | admin.connectcomptes | REAL UI + DEMO DATA |
| `/demo/connect/prestations` | admin.pre | REAL UI + DEMO DATA (mêmes prestations que `/demo/prestations`) |
| `/demo/connect/paiements-collectifs` | admin.cotisations | REAL UI + DEMO DATA |
| `/demo/full-communication` | cm.dash | PARTIAL — **pas d'écran "Full Communication" séparé, c'est un plan résolu dynamiquement** (voir pack § Full Communication) |
| `/demo/full-communication/production` | cm.briefs | REAL UI (peu de données démo) |
| `/demo/full-communication/validations` | cm.contenus | PARTIAL (validation intégrée à l'écran Contenus, pas de file dédiée) |
| `/demo/full-communication/presences` | — | **NOT IMPLEMENTED** (pas de suivi de présence, compteurs seulement) |
| `/demo/full-communication/publications` | cm.publications | REAL UI (peu de données démo) |
| `/demo/full-communication/rapports` | cm.rapports | REAL UI (peu de données démo) |
| `/demo/messages` | admin.msg | REAL UI + DEMO DATA |
| `/demo/notifications` | — | **NOT IMPLEMENTED** (cloche transverse, pas de page dédiée) |
| `/demo/roles` | admin.users | REAL UI + DEMO DATA |
| `/demo/permissions` | admin.users (alias) | PARTIAL — permissions réelles = gardes dans le code JS + RLS Postgres, pas de matrice UI (voir `SPORTVISION_OS_ROLE_MATRIX.md`) |
| `/demo/integrations` | admin.integrations | REAL UI (statuts, pas de vrais secrets) |
| `/demo/logs` | admin.audit | REAL UI (peu de données démo) |
| `/demo/parametres` | admin.set | REAL UI + DEMO DATA |

D'autres routes existent au-delà de la liste demandée dans le master prompt (héritées des 47 écrans admin) : `/demo/kanban`, `/demo/incidents`, `/demo/reservations-clubs`, `/demo/documents`, `/demo/grades`, `/demo/formation`, `/demo/annuaire`, `/demo/agences-cm`, `/demo/objectifs`, `/demo/pipeline`, `/demo/commissions`, `/demo/mes-revenus`, `/demo/resultat`, `/demo/rentabilite`, `/demo/immobilisations`, `/demo/tva`, `/demo/acomptes`, `/demo/impayes`, `/demo/avoirs`, `/demo/encaissements`, `/demo/clotures`, `/demo/fec`, `/demo/analytics` — toutes REAL UI + DEMO DATA. Toute route `/demo/<slug>` non listée ci-dessus affiche une page « module non disponible » explicite (200, pas de 404) plutôt qu'un écran vide ou trompeur.

**Ce qui n'a pas été touché** (hors périmètre de cette passe, pas de "grand refactor") : le contenu détaillé des écrans Médias/Postproduction, les scénarios narratifs multi-clients demandés en détail (§9-15 du master prompt — Lucas Martin, Horizon Sport, Tournoi International U15, etc. ne sont pas tous nommément recréés, seuls les jeux de données Finance ont été enrichis), la présence/validation Full Communication (n'existe pas dans le produit).

---

SportVision OS est une application monopage (SPA) à état interne — il n'existe pas de vrai routeur avec des URLs distinctes par écran dans le code source. La navigation se fait via deux variables JavaScript internes (`S.role`, `S.view`). Le mode démo (`?demo=1`) — gardé pour compatibilité des liens déjà partagés — accepte deux paramètres optionnels :

- `role=<id>` — bascule directement sur ce rôle (9 rôles disponibles, liste ci-dessous). Si omis : `admin`.
- `view=<id>` — ouvre directement cet écran pour le rôle choisi. Si omis : le premier écran du menu de ce rôle (« Tableau de bord » dans presque tous les cas).

Aucune connexion requise. Toutes les données affichées sont factices (voir `SPORTVISION_OS_AUDIT_PACK.md` § Mode démo pour le détail de ce qui est peuplé ou non). Un bandeau orange « MODE DÉMO » reste visible en bas d'écran, avec un sélecteur permettant de changer de rôle à la volée sans recharger l'URL.

**Important** : certains `id` d'écran ouvrent une fenêtre modale plutôt qu'un plein écran (colonne « Modale » ci-dessous) — le lien fonctionne quand même, la modale s'ouvre directement au chargement.

---

## Accès rapide — vue d'ensemble par thème

| Thème | URL |
|---|---|
| Tableau de bord (admin) | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=dash` |
| Planning | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=planning` |
| Prestations | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=pre` |
| Clients | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=crm` |
| Prospection | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=pipeline` |
| Devis | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=devis` |
| Contrats | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=contrats` |
| Agences CM | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=cmagency` |
| Réservations clubs | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=reservationsclubs` |
| Paiement collectif | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=cotisations` |
| Demandes Club+ (modale) | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=demandesclub` |
| Comptes Club+ / Connect | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=connectcomptes` |
| Collaborateurs | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=col` |
| Utilisateurs & accès | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=users` |
| Grades & XP | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=grades` |
| Centre de formation | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=form` |
| Kits (matériel) | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=kits` |
| Incidents | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=incidents` |
| Finances | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=fin` |
| Compte de résultat | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=resultat` |
| Rentabilité | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=rentabilite` |
| Commissions | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=commissions` |
| Immobilisations | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=immobilisations` |
| Budgets & prévisions | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=budgets` |
| TVA & provisions | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=tva` |
| Rapprochement | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=rapprochement` |
| Factures | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=factures` |
| Acomptes | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=acomptes` |
| Impayés | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=impayes` |
| Avoirs & remises | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=avoirs` |
| Encaissements Stripe | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=encaissements` |
| Dépenses | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=depenses` |
| Frais & km | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=frais` |
| Paiements équipe | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=paiements` |
| Rémunérations | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=rem` |
| Clôtures mensuelles | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=clotures` |
| Exports comptables | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=export` |
| Export FEC | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=fec` |
| Journal d'audit | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=audit` |
| Rapport mensuel | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=rapport` |
| Centre documentaire | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=documents` |
| Annuaire équipe | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=annuaire` |
| Mon équipe (en direct) | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=equipe` |
| Intégrations | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=integrations` |
| Messagerie | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=msg` |
| Centre SportVision (aide) | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=centre` |
| Paramètres | `https://sportvision-os.netlify.app/?demo=1&role=admin&view=set` |

---

## Liste complète par rôle (9 rôles réels)

Le menu réellement affiché change selon le rôle — un même `id` (ex. `dash`, `pre`, `planning`) peut exister pour plusieurs rôles avec un contenu différent (dashboard personnalisé, périmètre de données différent). La colonne « Modale » indique un `id` qui ouvre une fenêtre plutôt qu'un écran plein.

### admin — Administrateur (accès le plus large, 47 écrans)
`dash, planning, pre, crm, pipeline, devis, contrats, cmagency, reservationsclubs, cotisations, demandesclub*, connectcomptes, col, users, grades, form, kits, incidents, fin, resultat, rentabilite, commissions, immobilisations, budgets, tva, rapprochement, factures, acomptes, impayes, avoirs, encaissements, depenses, frais, paiements, rem, clotures, export, fec, audit, rapport, documents, annuaire, equipe, integrations, msg, centre, set`
(`*` = modale)

### sec — Secrétaire (26 écrans)
`dash, demandes, taches, relances, crm, devis, contrats, abonnements, cotisations, cmagency, demandesclub*, connectcomptes, pre, planning, livraisons, reservationsclubs, docs, rapports, annuaire, msg, form, centre, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=sec&view=demandes`

### prod — Responsable Production (24 écrans)
`dash, pre, planning, jourj, equipe, equipes, rem, frais, brief, kits, media, post, livr, kanban, incidents, budget, rapports, form, annuaire, msg, centre, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=prod&view=equipes`

### photo — Photographe / Vidéaste (11 écrans)
`dash, pre, planning, jourj, medias, kits, revenus, form, annuaire, msg, centre, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=photo&view=revenus`

### cm — Community Manager (17 écrans)
`dash, demandes, briefs, cal, contenus, publications, analytics, charge, rapports, clients, msgclients, annuaire, msg, form, centre, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=cm&view=cal`

### compta — Comptable (24 écrans)
`dash, resultat, rapprochement, rentabilite, commissions, immobilisations, budgets, factures, acomptes, impayes, avoirs, encaissements, cotisations, documents, paiements, rem, depenses, frais, clotures, export, fec, audit, tva, annuaire, msg, centre, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=compta&view=factures`

### com — Commercial (13 écrans)
`dash, pipeline, devis, objectifs, commissions, reservationsclubs, demandesclub*, connectcomptes, annuaire, msg, form, centre, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=com&view=pipeline`

### expert_comptable — Expert-comptable (lecture seule, 18 écrans)
`dash, resultat, rentabilite, commissions, immobilisations, budgets, tva, factures, avoirs, documents, depenses, frais, rem, clotures, export, fec, audit, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=expert_comptable&view=fec`

### auditeur — Auditeur (lecture seule, 15 écrans)
`dash, resultat, rentabilite, immobilisations, budgets, tva, factures, avoirs, depenses, frais, rem, clotures, audit, set`

URL type : `https://sportvision-os.netlify.app/?demo=1&role=auditeur&view=audit`

---

## Ce que l'auditeur ne doit PAS attendre

Un `id` d'écran qui n'apparaît dans AUCUNE des listes ci-dessus n'existe pas dans SportVision OS — inutile de le chercher (ex. rien qui s'appelle `structures`, `operateurs` au sens littéral, `recrutement`, `credits-clubplus`, `roles` en tant qu'écran séparé — ces notions existent mais sont rattachées à un autre écran, voir `SPORTVISION_OS_AUDIT_PACK.md` § Modules pour la correspondance).
