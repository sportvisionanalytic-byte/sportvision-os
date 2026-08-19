# SportVision OS — URLs de démonstration pour audit

**Base** : `https://sportvision-os.netlify.app/`

SportVision OS est une application monopage (SPA) à état interne — il n'existe pas de vrai routeur avec des URLs distinctes par écran dans le code source. La navigation se fait via deux variables JavaScript internes (`S.role`, `S.view`). Pour permettre malgré tout de donner une URL précise par écran à un auditeur externe, le mode démo (`?demo=1`) accepte désormais deux paramètres optionnels :

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
