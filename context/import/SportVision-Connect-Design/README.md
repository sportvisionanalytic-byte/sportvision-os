# Handoff — SportVision Connect

## La règle qui gouverne tout

**SportVision Connect est l'unique plateforme externe de SportVision.** Elle remplace
définitivement Club+ en tant que plateforme séparée, l'ancien Portail SportVision, les anciens
espaces Club, Coach, Académie et Projet, et les portails de livraison séparés.

| | |
|---|---|
| **SportVision OS** | Plateforme interne. Traitement, production, pilotage. Hors périmètre de ce handoff. |
| **SportVision Connect** | Plateforme externe unique. Demande, consultation, validation client. |
| **Club+** | N'est plus une plateforme. C'est une offre commerciale qui active des capacités **à l'intérieur** de Connect. |

Le critère de réussite est explicite : **on doit pouvoir créer une nouvelle offre SportVision sans
créer une nouvelle application.** Pas de `academyplus.sportvision.fr`. On active des capacités
dans Connect.

Corollaire : **une plateforme, plusieurs expériences.** Le joueur ne voit pas Club+. Le client
Full Communication ne fait pas le travail du Community Manager. L'éducateur ne voit que ses
équipes. Le parent ne voit que ses enfants.

---

## À propos des fichiers de design

Les fichiers de ce dossier sont des **références de design réalisées en HTML** : des prototypes qui
montrent l'apparence et le comportement attendus. **Ce n'est pas du code de production à copier
tel quel.** Toutes les données sont fictives, toutes les actions serveur sont simulées.

Le travail attendu est de **recréer ces designs dans l'environnement existant de la cible**
(React, Vue, Next.js — ce que le projet utilise déjà), en suivant ses conventions et sa
bibliothèque de composants. Si aucun environnement n'existe, choisissez la stack adaptée.

Ne reprenez pas la structure interne des prototypes (un fichier, styles en ligne, état local dans
une classe) : c'est une contrainte de l'outil de maquettage, pas une recommandation
d'architecture.

## Fidélité

**Haute fidélité.** Couleurs, typographie, espacements, rayons, ombres et micro-interactions sont
définitifs. Deux exceptions explicites :

- **Toutes les images sont des placeholders** — dégradés rayés avec un libellé monospace décrivant
  ce qui doit y aller. Aucune image réelle n'est fournie.
- **Les données sont fictives mais réalistes** — FC Fontainebleau, US Varenne, Elite Academy,
  Elite Cup 2026, Lucas Mendes. Elles illustrent la structure, pas des valeurs de production.
  Seules deux valeurs sont confirmées par le client : **Full Communication est sur devis**, et
  **l'offre inclut 40 crédits**.

---

## Les treize expériences

Un même utilisateur peut appartenir à plusieurs espaces. Le sélecteur d'organisation, en haut de
la barre latérale, recharge **navigation, permissions, contenus, documents, messages, prestations
et statistiques** au changement.

| Espace | Type | Offre | Action principale |
|---|---|---|---|
| FC Fontainebleau | `club` | Club+ Performance | Créer une demande |
| US Varenne | `club` | Full Communication | Valider sa communication |
| Elite Sport Camp | `academie` | Essentiel | Suivre une prestation |
| Elite Academy | `academie` | Full Communication | Piloter son calendrier |
| Chris Performance | `coach` | Full Communication | Voir son planning de contenus |
| Coaching Théo Lambert | `coach` | Club+ Start | Commander des contenus |
| Elite Cup 2026 | `ponctuel` | Full Communication | Préparer l'événement |
| Tournoi de la Rentrée | `ponctuel` | Prestation unique | Suivre sa prestation |
| Lucas Mendes | `joueur` | Accès via le club | Consulter ses contenus |
| Projet Amine Kaci | `joueur` | Essentiel | Réserver une prestation |
| Famille Fournier | `parent` | Accès via le club | Gérer les autorisations |
| Studio Nina Berger | `cm` | Club+ Start | Produire pour ses clubs |
| Varenne Auto | `sponsor` | Accès via le club | Suivre sa visibilité |
| Ligue du Gâtinais | `generic` | Prestation unique | Commander une prestation |

### La navigation est décidée par l'offre avant le type

```
if (plan === 'Full Communication') {
  if (type === 'coach')     return NAVS.coachFc;
  if (type === 'academie')  return NAVS.academieFc;
  if (type === 'ponctuel')  return NAVS.tournoiFc;
  return NAVS.fullcom;
}
if (type === 'club' && plan === 'Essentiel') return NAVS.standard;
return NAVS[type] || NAV;
```

Un joueur rattaché à un club abonné perd en plus Factures et Sponsors : le club les porte.

### Navigation groupée

Chaque navigation est découpée en sections nommées, insérées comme des entrées `['§', 'Libellé']`
dans le tableau. Aucun utilisateur ne voit plus de 6 à 10 rubriques principales.

**Club+ Performance** — 19 entrées
Accueil · **Club+** : Studio, Newsroom, Match Center · **Communication** : Communication,
Demandes, Contenus · **Club** : Calendrier, Équipes, Sponsors · **SportVision** : Prestations,
Accompagnement · **Gestion** : Contrats, Factures, Utilisateurs, Documents, Messages, Aide,
Paramètres

**Club Full Communication**
Accueil · **Communication** : Planning éditorial, À valider, Publications · **Production** :
Prestations, Présences, Médiathèque · **Performance** : Statistiques, Rapports · **Club** :
Équipes, Sponsors · **SportVision** : Mon Community Manager, Messages, Documents, Factures,
Paramètres

**Coach Full Communication**
Accueil · **Communication** : Planning, Contenus, À valider · **Production** : Tournages, Séances,
Médiathèque · **Performance** : Statistiques, Rapports · **SportVision** : Mon CM, Messages,
Documents, Paramètres

**Académie Full Communication**
Accueil · **Communication** : Planning éditorial, Contenus, À valider · **Académie** : Groupes,
Stages, Événements · **Production** : Prestations, Médiathèque · **Partenaires** : Sponsors ·
**Performance** : Statistiques, Rapports · **SportVision** : Mon CM, Messages, Documents,
Utilisateurs, Paramètres

**Tournoi Full Communication**
Accueil · **Événement** : Timeline, Équipes participantes, Programme · **Communication** :
Planning éditorial, Contenus, À valider, Live · **Production** : Prestations, Médiathèque ·
**Partenaires** : Sponsors · **Performance** : Statistiques, Rapport événement · **SportVision** :
Mon CM, Messages, Documents, Paramètres

**Club standard** (sans Club+)
Accueil · **SportVision** : Prestations, Demandes, Contenus · **Gestion** : Documents, Factures,
Messages, Utilisateurs, Paramètres

**Sponsor** — Accueil · **Mon partenariat** : Ma visibilité, Contenus sponsorisés, Opérations ·
**Documents** : Contrat et documents, Messages, Paramètres. Un partenaire ne voit rien du club :
ni équipes, ni factures du club, ni demandes.

**Structure sportive générique** — Accueil · **SportVision** : Prestations, Demandes, Contenus,
Calendrier · **Gestion** : Documents, Factures, Utilisateurs, Messages, Paramètres. Répond à
l'exigence d'accueillir de futurs clients hors catégories, sans créer d'application.

**Joueur** · **Parent** · **CM externe** — voir `ACTIONS.md`.

---

### Deux conventions de nommage à respecter

**Messages** porte les échanges — la messagerie contextuelle, rattachée à un objet.
**Aide** porte la documentation — centre d'aide, guides, tickets. Les deux ne se confondent jamais
et sont nommés ainsi dans **toutes** les navigations.

**Pas d'entrée « Vue mobile ».** Les maquettes mobiles sont accessibles dans le prototype par une
icône de la barre supérieure, à côté de la bascule de thème. C'est un outil de revue, pas une
rubrique produit : ne la reconstruisez pas.

## Arborescence des routes

```
/auth
  /login /forgot /verify /mfa /invite/:token /suspended /invite-expired

/signup
  /type /account /org /needs /plan /checkout /done

/onboarding

/dashboard                 variante par type et par offre

/studio                    Studio Club+ — marketplace de modèles
  /:template               fiche modèle + formulaire préremplí
/newsroom                  remontées des équipes
/matchcenter               saisie de résultats

/communication             planning éditorial — mois, semaine, liste
  /publications/:id
/validations               file de validation Full Communication
/publications              historique des publications
/presences                 présences terrain avec quota mensuel
/analytics                 statistiques resserrées
/reports                   rapports mensuels
/mycm                      fiche Community Manager

/requests /requests/new
/services /services/new /services/:id
/content /content/:id /content/collections/:id
/media                     alias de /content pour les navigations Full Com
/calendar
/teams /teams/:id /teams/players/:id
/sessions                  séances — coach
/camps                     stages — académie
/eventtimeline             timeline en 3 phases — événement
/live                      fil du jour — événement
/sponsors /sponsors/:id
/contracts /contracts/:id
/billing /billing/:id
/documents
/users
/children /authorizations  parent
/accompagnement            ce que l'offre inclut · accès délégués pour le CM
/notifications /notifications/preferences
/messages /messages/:thread
/support
/settings/profile /settings/organization /settings/integrations
```

---

## Logique d'abonnement

### Catalogue — source de vérité unique

| Offre | Tier | Prix | Crédits/mois | Présences/saison | Utilisateurs |
|---|---|---|---|---|---|
| Essentiel | 1 | 190 € / mois *(à confirmer)* | **0** | 0 | 3 |
| Club+ Start | 2 | 390 € / mois *(à confirmer)* | **10** | 2 | 8 |
| Club+ Performance | 2 | 690 € / mois *(à confirmer)* | **40** | 5 | illimités |
| Full Communication | 3 | **Sur devis** | **Sur mesure** | 12 | illimités |
| Accès via le club | 1 | Inclus dans l'offre du club | 3 | 0 | 1 |
| Prestation unique | 1 | Facturé à la commande | 1 | 1 | 2 |

Prix `null` = « sur devis » ou « à la commande » : l'interface affiche le libellé, pas un montant.
Les crédits **ne sont pas reportables**, attribués le 1er de chaque mois. Présences au-delà du
forfait : 240 € l'unité.

**Confirmé par le client** : crédits 0 / 10 / 40, et Full Communication sur devis.
**Non confirmé** : les montants mensuels 190 / 390 / 690 € sont une hypothèse de la maquette.

Essentiel n'inclut aucun crédit — c'est l'offre du client qui travaille à la prestation.
L'interface affiche « Créations · À la carte » plutôt qu'une jauge à zéro, et les conditions
contractuelles ne mentionnent pas de crédits mensuels.

### Les offres débloquent des capacités

| Capacité | Standard | Club+ Start | Club+ Performance | Full Communication |
|---|:-:|:-:|:-:|:-:|
| Prestations, documents, médiathèque, messages | ✓ | ✓ | ✓ | ✓ |
| Studio, crédits, équipes, demandes avancées | — | ✓ | ✓ | ✓ |
| Sponsors, statistiques, outils avancés | — | — | ✓ | ✓ |
| Planning éditorial, publications, validation, rapports, CM dédié | — | — | — | ✓ |

### Permissions centralisées

Interdiction formelle d'écrire `if (plan === "club_plus")` dans un écran. Quatre fonctions :

```ts
canAccess(module)        // le module est-il visible ?
canCreate(resource)      // le rôle autorise-t-il la création ?
hasEntitlement(feature)  // le contrat inclut-il cette option ?
hasQuota(quota)          // reste-t-il du quota ce mois-ci ?
```

Capacités nommées attendues : `can_view_studio`, `can_create_club_request`, `can_manage_teams`,
`can_view_analytics`, `can_validate_content`, `can_manage_users`, `can_manage_sponsors`,
`can_view_invoices`, `can_book_services`.

Une permission tient compte de : **utilisateur, organisation, rôle, équipe, ressource, offre.**
Le premier refus l'emporte.

**Un module verrouillé n'est jamais masqué sans explication.** Il reste dans la navigation avec un
cadenas et mène à un écran qui explique ce qu'il apporte.

### Pas de duplication de pages

Une seule `MediaLibrary` avec filtres et permissions selon le contexte — pas de
`ClubMediaLibrary` / `PlayerMediaLibrary` / `AcademyMediaLibrary`. Même principe pour documents,
messages, prestations, calendrier, notifications.

Ce qui change selon le contexte : le titre, le sous-titre, le jeu de données filtré, la présence
des collections. Pas le composant.

---

## Chaînes de statuts

Implémentez-les comme des machines à états.

**Demande** (moteur commun : visuel, modification, prestation, contenu, support, rendez-vous,
document)
`Brouillon → Envoyée → À compléter → Acceptée → En traitement → En production → À valider →
Correction → Terminée` · `Refusée` · `Annulée`

**Publication**
`Idée → À produire → En création → À valider → Corrections → Validé → Programmé → Publié` ·
`Erreur de publication` · `Annulée`

**Prestation**
`Demande reçue → À valider → Devis envoyé → Contrat à signer → Paiement en attente → Planifiée →
En cours → Postproduction → À valider → Livrée → Terminée` · `Annulée`

**Contrat**
`Brouillon → Envoyé → Consulté → Signé → Actif → À renouveler → Résilié` · `Expiré`

**Facture**
`Brouillon → À payer → Payée` · exception : `À payer → En retard → Suspension → Régularisée` ·
`Annulée` · `Remboursée`

**Ticket support**
`Ouvert → En cours → En attente du client → Résolu → Fermé`

### Règle d'impayé

Relances à **3, 8 et 15 jours**. Au-delà de 15 jours, création de nouvelles demandes suspendue.
Les contenus déjà livrés restent accessibles. La régularisation rétablit l'accès immédiatement.

*(Hypothèse posée dans la maquette — à confirmer.)*

---

## Design tokens

Voir `CHARTE.md` pour l'intégralité (couleurs, typographie, espacements, ombres, animations,
accessibilité). Résumé rapide ci-dessous.

### Couleurs — identité SportVision

**Surfaces sombres**

| Token | Hex |
|---|---|
| Fond principal | `#070A17` |
| Fond secondaire | `#0B1026` |
| Carte | `#111735` |
| Carte élevée | `#1A2145` |
| Surface creuse | `#0A0F26` |
| Bordure | `#252C4A` |
| Bordure forte | `#343C63` |

**Marque**

| Token | Hex |
|---|---|
| Bleu SportVision | `#2454FF` |
| Bleu électrique | `#1686FF` |
| Cyan | `#00C8FF` |
| Violet | `#832DFF` |
| Violet lumineux | `#C337FF` |
| Bleu pâle | `#8FB4FF` |

### Typographie

**Plus Jakarta Sans** (400 à 800) pour l'interface.
**JetBrains Mono** (400, 500) pour les références techniques : numéros de facture, identifiants,
timecodes, libellés de placeholder.

Transitions : `.14s` à `.18s ease`. Rien au-delà de `.3s`.

---

## Style visuel

Connect ne doit ressembler ni à un CRM générique, ni à une interface bancaire, ni à un tableau
administratif, ni à un SaaS blanc sans identité.

Privilégier : images, grandes cartes, médias sportifs, dégradés maîtrisés, timelines, aperçus
vidéo, indicateurs de progression, micro-animations, badges.

### Micro-interactions

- **Survol de carte** — `translateY(-2px)` + bordure accentuée + ombre portée
- **Bouton principal au survol** — `filter: brightness(1.06)`
- **Apparition de menu** — `opacity 0→1` + `translateY(6px→0)` en `.16s ease`
- **Skeleton** — dégradé glissant, `1.3s linear infinite`, `background-size: 420px 100%`
- **Toast** — bas-droite, auto-disparition à 3,2 s
- **Barre de progression** — `width` en `.3s ease`

### États de chargement

À chaque changement d'écran, skeletons pendant **520 ms** : bloc de titre, rangée de 4 cartes,
tableau de 5 lignes. `aria-busy="true"` et `aria-live="polite"`.

### États vides

Ils guident vers l'action, ils ne constatent pas l'absence.

> Aucun contenu à valider
> Tout est à jour.

> Vous n'avez encore créé aucune demande.
> Commencez par demander votre premier visuel.
> **[Demander un visuel]**

### Erreurs

Jamais `500 API ERROR`. Toujours :

> Une erreur empêche actuellement l'affichage de vos contenus. Réessayez dans quelques instants.

### Glisser-déposer

Planning éditorial, **vue mois et vue semaine**, si le rôle l'autorise. `cursor: grab` au repos,
`grabbing` en action. Bandeau « Déplacement de X » pendant le glissement. Cellules de dépôt en
fond translucide + bordure pointillée. Au dépôt : liseré vert et toast de confirmation. Les
cellules des mois adjacents refusent le dépôt.

### Responsive

| Largeur | Comportement |
|---|---|
| ≤ 1100 px | Grilles 7 colonnes → 4 |
| ≤ 1000 px | Grilles 3 et 4 colonnes → 2 |
| ≤ 900 px | Grilles 2 colonnes → 1, sections alternées empilées |
| ≤ 760 px | **En-têtes de tableau masqués, lignes en cartes**, kanban pleine largeur |
| ≤ 700 px | Grilles → 1 colonne, H1 38 px, padding latéral 18 px |

Mobile : barre latérale en menu, navigation basse à 5 entrées (Accueil, Contenus, Calendrier,
Messages, Profil), bouton central `+` pour une nouvelle demande, médias plein écran.

**Priorité d'affichage mobile par profil**
Full Communication : ce qu'il faut valider, prochain événement, prochain tournage, publications,
messages. Club+ : créer une demande, crédits, à valider, dernières créations. Joueur : prochaine
prestation, galerie, réservation.

### Accessibilité

Contrastes AA vérifiés au calcul, y compris sur les puces en 11 px gras. `aria-label` sur tout
bouton icône seule. Focus visible via `:focus-visible` uniquement, jamais confondu avec l'état
actif de la route. Cibles ≥ 44 px sur mobile. La couleur n'est jamais seule porteuse
d'information : chaque puce porte son libellé.

---

## Ce que le client ne doit jamais voir

**Jargon technique** — `tenant`, `entitlement`, `provider`, `metricool_brand_id`, `role_code`,
`database_id`, `subscription_status`. Traduire systématiquement.

Au lieu de `plan = full_com_active`, afficher :

> Full Communication
> Accompagnement actif

**Coûts internes** — coût opérateur, marge, commission, salaire, coût CM, dépenses internes.

**Données d'autres clients**, secrets d'API, tokens, logs serveur, IDs Metricool, erreurs de
synchronisation techniques.

**Commentaires internes OS.** Deux catégories distinctes avec des permissions séparées :
`INTERNE SPORTVISION` et `VISIBLE CLIENT`. Jamais de fuite de l'une vers l'autre.

---

## Intégrations vues du client

| Service | Ce que Connect affiche | Ce que Connect masque |
|---|---|---|
| **Stripe** | Paiements, abonnement, facture, moyen de paiement (4 derniers chiffres) | Tout le reste. Aucun numéro de carte complet. |
| **Yousign** | « Contrat à signer », CTA « Signer mon contrat », puis « Contrat signé ✓ » | Le mécanisme de signature |
| **Metricool** | Publications, statuts, analytics, calendrier | Token, synchronisation, IDs, erreurs d'API |
| **Google Calendar** | Ajout d'une prestation ou d'un rendez-vous au calendrier personnel | La source de vérité reste Connect/OS |

Portées Google demandées : lire les calendriers, créer et modifier des événements, lire le profil.
**Supprimer des événements n'est jamais demandé.**

---

## Synchronisation Connect ↔ OS

Règle fondamentale : **Connect = demande / consultation / validation client. OS = traitement /
production / pilotage SportVision.** La même donnée circule sans double saisie.

**Workflow Club+**
```
Club crée une demande (Connect)
  → crédits réservés
  → OS reçoit la demande
  → CM réalise
  → Connect reçoit la création
  → club valide ou corrige
  → OS reçoit la décision
  → contenu livré
  → crédits définitivement consommés
```

**Workflow Full Communication**
```
Client transmet une information (Connect)
  → OS crée le brief
  → CM produit
  → validation interne (OS)
  → client reçoit le contenu (Connect)
  → client valide
  → OS reçoit la validation
  → CM programme
  → publication
  → stats remontées dans Connect
```

**Workflow prestation**
```
Demande → devis → contrat → paiement → planning → production
  → postproduction → livraison → facture → archive
```

---

## Ton rédactionnel

Professionnel, simple, sportif, humain, direct, rassurant.

> « Votre contenu est prêt à être validé. »
> « Il vous reste 8 crédits ce mois-ci. »
> « Votre prochaine présence SportVision est prévue samedi. »
> « Une correction a été demandée. »
> « Votre paiement a bien été enregistré. »

Règles : une seule action principale par écran · échéances écrites en clair · montants suivis de
TTC ou HT · jamais de donnée bancaire complète · un rappel maximum par échéance et par semaine.

---

## Checklists

**Pour chaque page** — Qui l'utilise ? Pourquoi ? Quelle action principale ? Quelles données sont
vraiment utiles ? Que faut-il cacher ? Quelle version mobile ? Quel état vide, loading, erreur ?
Quelles permissions ? Quelle interaction avec OS ?

**Pour chaque action** — Qui déclenche ? Où ? Quelle donnée est créée ? Qui est notifié ? Qui
traite ? Quel statut suivant ? Que voit le client ? Que voit SportVision ? Quel historique ?

---

## Ordre de priorité produit

1. **Architecture commune** — auth, organisations, rôles, permissions, design system, navigation dynamique
2. **Full Communication** — déjà utilisé commercialement
3. **Prestations ponctuelles et joueurs**
4. **Migration Club+**
5. **Coach, Académie, Tournoi Full Communication**
6. **Fonctions avancées** — analytics, automatisations, génération automatique

### Non-régression

Avant de supprimer une ancienne interface Portail ou Club+ : vérifier la migration, vérifier les
données, tester le remplacement, sauvegarder, comparer les processus, vérifier qu'aucun lien n'en
dépend. Puis seulement : `deprecated → read only → archived → supprimée`.

---

## Nombre d'entrées par navigation

Le document produit demande 6 à 10 rubriques principales par utilisateur. Les navigations
sectionnées dépassent ce nombre en entrées brutes mais restent lisibles grâce aux titres de
section. Les profils légers respectent la contrainte.

| Profil | Entrées |
|---|--:|
| Sponsor | 7 |
| Client ponctuel | 8 |
| Parent | 9 |
| Club standard | 9 |
| Structure générique | 10 |
| Joueur | 11 |
| CM externe | 12 |
| Coach Full Com | 13 |
| Académie · Coach Club+ | 13 |
| Club Full Communication | 16 |
| Académie · Tournoi Full Com | 17 |
| Club+ Performance | 19 |

## Fichiers de ce dossier

| Fichier | Sur disque ? | Contenu |
|---|---|---|
| `README.md` | oui | Ce document |
| `CHARTE.md` | oui | Charte graphique complète — logo, couleurs, typographie, composants, animations |
| `ACTIONS.md` | oui, intégral | Inventaire exhaustif des boutons, cibles et effets, écran par écran |
| `DATA_MODEL.md` | oui, intégral | Entités, champs, relations, énumérations, séquences serveur |
| `SportVision Connect - Connectique.dc.html` | oui, intégral | Les parcours écran par écran (prototype interactif, pas du code de prod) |
| `SportVision Connect - Design System.dc.html` | oui, intégral | Fondations et composants avec leurs états |
| `SportVision Connect.dc.html` (app complète, tous les écrans) | **non persisté** — trop volumineux, redondant avec ACTIONS.md + DATA_MODEL.md qui couvrent déjà chaque écran | — |
| `SportVision Connect - E-mails.dc.html` (e-mails transactionnels) | **non persisté** — objets/actions déjà dans ACTIONS.md §27 ; seul le corps littéral de chaque e-mail manque | — |
| `logo-sportvision.png` | **non fourni** | Logo réel — utiliser un placeholder « SV » en dégradé en attendant |
| `support.js` | **non persisté volontairement** — moteur de rendu de l'outil de maquettage, aucune valeur de référence design, jamais à porter | — |

Si le corps exact d'un des e-mails ou le détail pixel d'un écran de l'app complète est nécessaire
plus tard, redemander ces fichiers à l'utilisateur plutôt que de deviner.

---

## Note de session (2026-08-08)

Mise à jour reçue le 08/08, remplaçant intégralement la version du 06/08 (police Manrope → Plus
Jakarta Sans, couleurs recalibrées, catalogue de crédits confirmé par le client à 0/10/40, 9 types
d'organisation au lieu de 5, Full Communication détaillé comme palier à part entière avec ses
propres écrans).

**Décision confirmée avec Fouka le 08/08 : on part sur une vraie construction complète de Connect**
(reversal de la note du 06/08, qui disait de ne piocher que des concepts ponctuels dans les apps
vanilla-JS existantes sans réécriture globale). Priorité choisie : architecture commune en premier
(auth, organisations, rôles, permissions, design system, navigation dynamique), conformément à
l'ordre de priorité produit ci-dessus.

L'app existante `livrables/SportVision-Connect/app` (vanilla JS, sans build, 11 modules par espace)
reste en service en lecture pendant la construction, sans coupure, jusqu'à validation de chaque
espace équivalent côté nouvelle plateforme — voir la politique de non-régression ci-dessus.
