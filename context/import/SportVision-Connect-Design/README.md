# Handoff — SportVision Connect

## Vue d'ensemble

SportVision Connect est l'unique plateforme externe de SportVision, destinée à tous ses clients.
Elle remplace définitivement SportVision Club+ en tant que plateforme séparée, l'ancien Portail
SportVision, les anciens espaces Club, Coach, Académie et Projet, ainsi que les portails de
livraison séparés.

Répartition à retenir :

- **SportVision OS** — plateforme interne de l'entreprise (hors périmètre de ce handoff)
- **SportVision Connect** — plateforme externe unique pour tous les clients (objet de ce handoff)
- **Club+** — n'est plus une plateforme. C'est une offre commerciale et un ensemble de
  fonctionnalités activées **à l'intérieur** de Connect.

Une seule organisation peut être un club, une académie, un coach, un joueur ou un client ponctuel.
Un même utilisateur peut appartenir à plusieurs organisations avec un rôle différent dans chacune.

---

## À propos des fichiers de design

Les fichiers de ce dossier sont des **références de design réalisées en HTML** : des prototypes qui
montrent l'apparence et le comportement attendus. **Ce n'est pas du code de production à copier
tel quel.**

Le travail attendu est de **recréer ces designs dans l'environnement existant de la cible**
(React, Vue, Next.js, ce que le projet utilise déjà), en suivant ses conventions, sa bibliothèque
de composants et ses patterns établis. Si aucun environnement n'existe encore, choisissez la stack
la plus adaptée au projet et implémentez-y les designs.

Ne reprenez pas la structure interne des prototypes (un seul fichier, styles en ligne, état local
dans une classe) : c'est une contrainte de l'outil de maquettage, pas une recommandation
d'architecture.

## Fidélité

**Haute fidélité.** Couleurs, typographie, espacements, rayons, ombres et micro-interactions sont
définitifs. Recréez l'interface au pixel près en vous appuyant sur les composants existants du
codebase.

Deux exceptions explicites :

- **Toutes les images sont des placeholders** — des dégradés rayés avec un libellé monospace
  décrivant ce qui doit y aller (« photo de match », « portrait joueur », « aperçu — affiche
  Matchday 1:1 »). Aucune image réelle n'est fournie.
- **Les données sont fictives mais réalistes** — FC Fontainebleau, US Varenne, Elite Sport Camp,
  Lucas Mendes, factures SV-2026-XXXX. Elles illustrent la structure attendue, pas des valeurs de
  production.

---

## Architecture d'interface

### Structure desktop

```
┌────────────┬───────────────────────────────────────────────┐
│            │  Barre supérieure (66 px, sticky, blur)      │
│  Barre     ├──────────────────────────────────────────────┤
│  latérale  │                                              │
│  264 px    │  Zone centrale                               │
│  sticky    │  padding 26px 28px 56px                      │
│  100vh     │                                              │
│            │                                              │
└────────────┴───────────────────────────────────────────────┘
```

**Barre latérale — 264 px, `flex: none`, `position: sticky`, `height: 100vh`**

Fond `#080B1A` en permanence, y compris en mode clair. C'est un chrome sombre, pas une surface
thématisée : ne le reliez pas au token de fond de page.

De haut en bas : logo SportVision Connect, sélecteur d'organisation, navigation principale
(scrollable), carte d'offre avec jauge de crédits, raccourci support, profil utilisateur avec
déconnexion.

**Barre supérieure — 66 px**

Fil d'Ariane + titre de page, recherche globale (270 px, `flex: none`), bouton d'action principal,
notifications avec badge, bascule de thème, aide, avatar profil. Tous les contrôles de droite
portent `flex: none` ; seul le bloc titre est `flex: 1 1 auto` avec `min-width: 0`.

### Arborescence des routes

```
/auth
  /login                 connexion
  /forgot                mot de passe oublié
  /verify                vérification e-mail
  /mfa                   double authentification + codes de secours
  /invite/:token         acceptation d'invitation, création du mot de passe
  /suspended             compte suspendu (impayé)
  /invite-expired        lien d'invitation périmé

/signup
  /type                  1 — type de structure
  /account               2 — vos informations
  /org                   3 — votre organisation
  /needs                 4 — vos besoins
  /plan                  5 — choix de l'offre
  /checkout              6 — récapitulatif, paiement ou devis
  /done                  7 — espace prêt

/onboarding              parcours guidé 10 étapes, reprenable

/dashboard               tableau de bord (variante par type d'organisation)
/communication           planning éditorial — vues mois, semaine, liste
  /publications/:id      fiche publication (panneau latéral)
/requests                demandes de visuels
  /new                   formulaire de demande (modale)
/services                prestations — kanban et liste
  /new                   tunnel 5 étapes (modale)
  /:id                   fiche prestation, 10 onglets
/content                 bibliothèque — vues grille et liste
  /:id                   fiche média (panneau latéral)
  /collections/:id       détail de collection (panneau latéral)
/calendar                calendrier central — mois, semaine, jour, liste
/teams                   équipes
  /:id                   fiche équipe, 6 onglets
  /players/:id           fiche joueur (panneau latéral)
/sponsors                sponsors
  /:id                   fiche sponsor, 4 onglets (panneau latéral)
/contracts               contrats
  /:id                   fiche contrat (panneau latéral)
/billing                 factures et paiements
  /:id                   fiche facture (panneau latéral)
/documents               documents et autorisations
/users                   utilisateurs et rôles
/notifications           centre de notifications
  /preferences           préférences par catégorie (modale)
/support                 centre d'aide, guides, tickets
  /thread                fil de messages (client ponctuel uniquement)
/settings
  /profile               paramètres personnels
  /organization           paramètres organisation
  /integrations           intégrations
    /:provider           panneau de synchronisation (modale)
```

### Navigation par type d'organisation

La navigation entière change selon le type. Chaque entrée porte un niveau d'offre minimum
(`tier`) ; en dessous, l'entrée reste visible avec un cadenas et mène à l'écran
« module inclus dans une offre supérieure ».

Le **joueur rattaché à un club abonné** est un cas important : il n'a ni Factures ni Sponsors,
parce que son accès est financé par l'abonnement du club. Son espace affiche un bandeau
« Rattaché au FC Fontainebleau · CLUB ABONNÉ » et le sélecteur d'organisation montre le club parent
en dessous de son nom.

---

## Logique d'abonnement

### Catalogue d'offres — source de vérité unique

Aucun écran ne doit tester le nom d'une offre. Toutes les valeurs dérivent de ce catalogue.

| Offre | Tier | Prix | Crédits/mois | Présences/saison | Utilisateurs |
|---|---|---|---|---|---|
| Essentiel | 1 | 190 € / mois | 8 | 0 | 3 |
| Club+ Start | 2 | 390 € / mois | 14 | 2 | 8 |
| Club+ Performance | 2 | 690 € / mois | 20 | 5 | illimités |
| Full Communication | 3 | **Sur devis** | **40** | 12 | illimités |
| Accès via le club | 1 | Inclus dans l'offre du club | 3 | 0 | 1 |
| Prestation unique | 1 | Facturé à la commande | 1 | 1 | 2 |

Les crédits ne sont **pas reportables** d'un mois sur l'autre. Ils sont attribués le 1er de chaque
mois. Les présences terrain au-delà du forfait sont facturées 240 € l'unité.

### Permissions centralisées

Interdiction formelle d'écrire `if (plan === "club_plus")` dans les écrans. Quatre fonctions :

```ts
canAccess(module: string): boolean          // le module est-il visible ?
canCreate(resource: string): boolean        // le rôle autorise-t-il la création ?
hasEntitlement(feature: string): boolean    // le contrat inclut-il cette option ?
hasQuota(quota: string): boolean            // reste-t-il du quota ce mois-ci ?
```

**Un module verrouillé n'est jamais masqué sans explication.** Il reste dans la navigation avec un
cadenas, et son écran explique ce qu'il apporte avec deux sorties : « Parler à mon conseiller » et
« Découvrir les offres ».

### Rôles

Neuf rôles : propriétaire, administrateur, responsable communication, éducateur, dirigeant,
secrétaire, lecteur, sponsor, invité.

---

## Design tokens

### Couleurs

**Chrome sombre — barre latérale, cartes premium, écrans de connexion**

| Token | Hex |
|---|---|
| Bleu nuit | `#080B1A` |
| Bleu profond | `#111735` |
| Bleu encre | `#1D2657` |
| Violet profond | `#4A1E9E` |
| Texte inversé | `#DCE4F7` |
| Texte secondaire sombre | `#7E93C7` |

**Marque**

| Token | Hex |
|---|---|
| Bleu SportVision | `#244BFF` |
| Bleu électrique | `#1A7CFF` |
| Cyan | `#00C8FF` |
| Violet | `#8A2EFF` |
| Violet clair | `#C337FF` |
| Bleu pâle | `#8FB4FF` |

**Neutres — mode clair**

| Token | Hex |
|---|---|
| Blanc | `#FFFFFF` |
| Fond clair | `#F5F7FB` |
| Surface alternée | `#FAFBFE` |
| Surface creuse | `#EFF2F8` |
| Bordure | `#E8ECF4` |
| Bordure forte | `#D5DBE7` |
| Texte | `#111827` |
| Texte doux | `#344054` |
| Texte secondaire | `#667085` |
| Texte discret | `#98A2B3` |

**Sémantique**

| Sens | Fond | Texte |
|---|---|---|
| Succès | `#ECFDF3` | `#027A48` |
| Alerte | `#FEF0C7` | `#B54708` |
| Erreur | `#FEF3F2` | `#B42318` |
| Information | `#EEF2FF` | `#244BFF` |
| Accent | `#F6EEFF` | `#8A2EFF` |
| Cyan | `#E6F9FF` | `#03688A` |
| Neutre | `#F2F4F7` | `#667085` |

**Dégradés — usage restreint**

| Usage | Valeur |
|---|---|
| Action principale | `linear-gradient(135deg, #244BFF, #8A2EFF)` |
| Carte premium | `linear-gradient(135deg, #111735 0%, #1B2A6B 55%, #4A1E9E 100%)` |
| Progression | `linear-gradient(90deg, #00C8FF, #C337FF)` |
| Validation | `linear-gradient(135deg, #12B76A, #00C8FF)` |

### Typographie

**Manrope** (400, 500, 600, 700, 800) pour toute l'interface.
**JetBrains Mono** (400, 500) pour les références techniques.

### Ton rédactionnel

Professionnel, simple, sportif, humain, direct, rassurant. Pas de jargon technique visible par le
client. Une seule action principale par écran. Les échéances sont écrites en clair, jamais en jours
relatifs seuls. Les montants sont toujours suivis de TTC ou HT. Jamais de donnée bancaire complète
affichée, jamais de mot de passe en clair.

---

## Fichiers de ce dossier

| Fichier | Sur disque ? | Contenu |
|---|---|---|
| `README.md` | oui | Ce document |
| `ACTIONS.md` | oui, intégral | Inventaire exhaustif des boutons, leurs cibles et leurs effets (21 sections) |
| `DATA_MODEL.md` | oui, intégral | Entités, champs, relations, énumérations |
| `SportVision Connect - Connectique.dc.html` | oui, intégral | Les 5 parcours écran par écran (prototype interactif, pas du code de prod) |
| `SportVision Connect - Design System.dc.html` | oui, markup complet (bloc JS de valeurs tronqué, doublon du tableau de tokens ci-dessus) | Fondations et composants avec leurs états |
| `SportVision Connect.dc.html` (app complète, tous les écrans) | **non persisté** — trop volumineux (~150 Ko), redondant avec ACTIONS.md + DATA_MODEL.md qui couvrent déjà chaque écran | — |
| `SportVision Connect - E-mails.dc.html` (8 e-mails transactionnels) | **non persisté** — objets/actions déjà dans ACTIONS.md §21 ; seul le corps littéral de chaque e-mail manque | — |
| `support.js` | **non persisté volontairement** — moteur de rendu de l'outil de maquettage (parseur de template, runtime React), aucune valeur de référence design, jamais à porter | — |

Si le corps exact d'un des 8 e-mails ou le détail pixel d'un écran de l'app complète est nécessaire
plus tard, redemander ces fichiers à l'utilisateur plutôt que de deviner.

Note de session (2026-08-06) : décision prise de NE PAS migrer l'écosystème SportVision (OS, Portail,
Club+) vers cette architecture Connect. On mine ce dossier au cas par cas pour des concepts précis
(pattern "module verrouillé", préférences de notification, copy/tokens) à reproduire dans les apps
vanilla-JS existantes, sans réécriture globale.
