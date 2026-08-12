# Handoff : refonte SportVision Connect

## Vue d'ensemble

SportVision Connect est l'application **personnelle** de l'écosystème SportVision (aux côtés de Club+ pour les organisations et OS en interne). Cette refonte transforme un ancien dashboard d'administration de club en une application sportive personnelle, organisée autour d'un fil conducteur unique :

**mon compte → mon club → mon équipe → ma prestation → notre cotisation → mes contenus**

Deux expériences partagent la même authentification, la même direction artistique et les mêmes composants :

- **Espace joueur** — « CONNECT = MOI ». Le joueur gère son univers sportif.
- **Espace particulier** — parent, responsable légal, proche ou agent. L'utilisateur accompagne un ou plusieurs sportifs ; son point d'entrée est « Mes sportifs ».

Règle produit à ne jamais contourner : **aucune fonction d'administration de club dans Connect** (factures du club, contrats, utilisateurs de l'organisation, crédits Club+, gestion de l'offre). Ces pages ne sont pas verrouillées : elles n'existent pas. En revanche, **toutes les finances personnelles de l'utilisateur sont présentes** (ses commandes, ses factures, ses participations).

## À propos des fichiers de design

Les fichiers de ce dossier sont des **références de design réalisées en HTML** : des prototypes qui montrent l'intention visuelle et le comportement attendu. Ce n'est pas du code de production à copier tel quel.

Le travail consiste à **recréer ces écrans dans l'environnement existant du produit** (React, Vue, Next, SwiftUI, natif…) en suivant les patterns, la librairie de composants et les conventions déjà en place. Si aucun environnement front n'existe encore, choisissez le framework le plus adapté et implémentez-y les écrans.

Les prototypes utilisent un moteur de template maison (`<sc-if>`, `<sc-for>`, `{{ valeur }}`) : ne le portez pas. Lisez-le comme de la logique conditionnelle et des boucles ordinaires.

## Fidélité

**Haute fidélité (hifi).** Couleurs, typographie, espacements, rayons, états et copies sont définitifs et doivent être reproduits fidèlement avec les composants du codebase. Les seules exceptions assumées :

- Les photos sportives sont remplacées par des **placeholders en dégradé** (aucune image générée). Prévoyez les emplacements réels.
- Les données sont simulées côté client ; aucun appel réseau, aucun paiement, aucun envoi d'e-mail.

## Direction artistique

Fond bleu nuit très sombre, surfaces vitrées, dégradé signature violet → bleu → cyan réservé aux CTA et aux éléments forts, une couleur par pilier fonctionnel.

### Couleurs

| Rôle | Valeur |
|---|---|
| Fond principal | `#09081A` |
| Fond élevé (cartes pleines, modales) | `#0D0B22` |
| Fond élevé accentué (cotisation) | `#100C24` |
| Surface | `rgba(255,255,255,.05)` |
| Surface survolée | `rgba(255,255,255,.09)` |
| Bordure standard | `rgba(255,255,255,.09)` |
| Bordure renforcée (champs, boutons secondaires) | `rgba(255,255,255,.14)` — `rgba(255,255,255,.2)` |
| Texte primaire | `#F7F7FB` |
| Texte secondaire | `#C7C7DE` |
| Texte tertiaire | `#9A9AB8` |
| Texte discret | `#7A7A9C` |
| Label majuscule | `#6C6C90` |
| Dégradé signature | `linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)` |
| Affiliations / validé | `#22D3EE` (fond `rgba(34,211,238,.14)`) |
| Contenus | `#C084FC` (fond `rgba(168,85,247,.16)`) |
| Prestations | `#8CA9FF` (fond `rgba(79,125,255,.16)`) |
| Cotisations | `#F472B6` (fond `rgba(244,114,182,.14)`) |
| Attente / avertissement | `#FBBF24` (fond `rgba(251,191,36,.14)`) |
| Erreur / danger | `#F472B6` (bordure `rgba(244,114,182,.4)`) |
| Dégradé progression cotisation | `linear-gradient(90deg,#A855F7,#F472B6)` |
| Dégradé progression financée | `linear-gradient(90deg,#4F7DFF,#22D3EE)` |

Les fonds de placeholders média sont trois dégradés fixes :
`linear-gradient(135deg,#3B1E6E,#22307A 55%,#0F4C63)`, `linear-gradient(135deg,#4C1D95,#3A2A86 50%,#155E75)`, `linear-gradient(135deg,#5B1E5B,#3F2280 55%,#1E3A8A)`.

Les avatars et monogrammes utilisent cinq dégradés : `#A855F7→#4F7DFF`, `#4F7DFF→#22D3EE`, `#22D3EE→#A855F7`, `#F472B6→#A855F7`, `#8CA9FF→#22D3EE` (angle 140°).

### Typographie

- **Sora** — titres, noms de produits, chiffres clés, libellés de boutons. Poids 600/700, `letter-spacing` de `-.02em` à `-.035em`.
- **DM Sans** — texte courant, labels, champs. Poids 400/500.
- **IBM Plex Mono** — références techniques (n° de commande, liens, mentions de placeholder), 11 px, `letter-spacing .08em`, majuscules.
- **Material Symbols Rounded** — bibliothèque d'icônes unique.

Échelle appliquée :

| Usage | Desktop | Mobile |
|---|---|---|
| H1 de page | 33 px / 700 / `-.03em` | 27 px |
| H1 hero (accueil, marketing) | 40–46 px / 700 / `-.035em` | 26–27 px |
| H2 de section | 20 px / 600 | 18 px |
| H3 de carte | 16–19 px / 600 | idem |
| Corps | 15 px / 1.6 | 14–15 px |
| Corps secondaire | 13–14 px / 1.55 | idem |
| Label majuscule | 11 px / 500 / `.1em` / uppercase | idem |
| Mono | 11–12 px | idem |

### Espacements, rayons, ombres

- Échelle d'espacement : 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 26 / 30 / 34.
- Rayons : 999 px (pills, badges), 10–14 px (petits blocs, boutons secondaires internes), 15–16 px (champs, boutons), 17–20 px (icônes conteneurs, cartes internes), 22–24 px (cartes principales, modales), 34–42 px (cadres mobiles).
- Bordure dégradée : conteneur avec `padding:1px` et fond dégradé, enfant avec rayon − 1 px et fond opaque.
- Ombres : uniquement sur les surfaces flottantes — `0 30px 70px -20px rgba(0,0,0,.75)`.
- Hauteurs de contrôles : boutons et champs 52–56 px, boutons secondaires internes 42–48 px, zones tactiles jamais sous 44 px.
- Largeur max du contenu : 1160 px ; colonnes de formulaire 560–760 px ; deux colonnes `minmax(0,1.62fr) minmax(0,1fr)`.

### Composants transverses

- **Boutons** — Primary (dégradé signature, texte blanc, `filter:brightness(1.12)` au survol) ; Secondary (`rgba(255,255,255,.06)` + bordure `.14`) ; Ghost (texte seul) ; Danger (fond `rgba(244,114,182,.08)`, bordure `rgba(244,114,182,.4)`, texte `#F472B6`).
- **Cartes** — Standard, Media (cover + métadonnées), Action (icône + titre + sous-titre + chevron), Progress (montants + barre), Profile (avatar + identité). Pas d'autre famille.
- **Badges** — pills 11–12 px : Affilié, En attente, Club déclaré, Confirmée, En production, Livrée, Terminée, Annulée, Paiement à plusieurs, Recommandé.
- **Barres de progression** — hauteur 7/8/10/12 px selon contexte, rayon 999 px, fond `rgba(255,255,255,.08)`.
- **Onglets** — pills, actif = fond teinté du pilier + bordure assortie.
- **Tuiles de sélection** — bordure `rgba(140,169,255,.6)` et fond `rgba(79,125,255,.12)` quand sélectionnées, pastille `check_circle` cyan.
- **Empty states** — carte à bordure pointillée `rgba(255,255,255,.14)`, icône teintée, titre 18–19 px, texte explicatif, CTA facultatif.
- **Skeletons** — blocs `rgba(255,255,255,.05)`, animation `sv-pulse` 1.4 s (opacité .55 → 1), décalages de 100 à 300 ms.
- **Toast** — bas centré, fond `#141032`, bordure `rgba(255,255,255,.14)`, icône `check_circle` cyan, disparition après 2,4 s.

### Animations

- `sv-in` : opacité 0→1 + `translateY(10px)`, 280–300 ms `ease` — apparition de page.
- `sv-sheet` : `translateY(100%)`→0, 260 ms `cubic-bezier(.22,1,.36,1)` — bottom sheets mobiles.
- `sv-fade` : 180 ms — voiles de modales.
- Transitions locales : 160–180 ms `ease` sur `background`, `border-color`, `width`, `filter`.

## Shell et navigation

### Desktop

Sidebar 250–252 px, collante, hauteur d'écran, séparée par une bordure `rgba(255,255,255,.07)`. Le bloc utilisateur en bas ouvre le menu profil.

**Espace joueur**

```
Accueil
MON UNIVERS      Mes affiliations · Mes équipes
SPORTVISION      Prestations · Cotisations · Mes contenus · Mes commandes · Calendrier · Messages
MON COMPTE       Factures & paiements · Mon profil
```

**Espace particulier**

```
Accueil
MES SPORTIFS     Mes sportifs
SPORTVISION      Prestations · Cotisations · Mes contenus · Mes commandes · Calendrier · Messages
MON COMPTE       Factures & paiements · Mon profil
```

Topbar collante (hauteur 76 px avec padding) : recherche globale (max 420 px), notifications avec pastille, aide (`?`), avatar. L'aide n'est **pas** dans la sidebar — le `?` de la topbar est son unique accès.

Dans l'espace particulier, la sidebar contient en plus, sous le logo, le **sélecteur de contexte** (« Vous consultez : Tous mes sportifs / Lucas / Noah »).

### Mobile (< 860 px)

Header collant : logo, sélecteur de contexte (particulier), recherche (icône → plein écran), notifications, avatar. Bottom nav 5 onglets, `env(safe-area-inset-bottom)` respecté.

- Joueur : Accueil · Contenus · Prestations · Cotisations · Profil, puis feuille « Plus » (affiliations, équipes, commandes, factures, calendrier, messages, profil, aide).
- Particulier : Accueil · Sportifs · Prestations · Contenus · Profil.

CTA sticky au-dessus de la bottom nav (`bottom:70px`) sur : fiche prestation, wizard de réservation, création de cotisation, détail de cotisation, fiche sportif.

## Écrans

### Authentification (`Connect Connexion Web.dc.html`)

- **Connexion** — deux colonnes 55 / 45. Gauche : photo sportive (emplacement à remplir) en haut, storytelling en dessous sur fond `#0C0A1E` (« Votre sport. Vos contenus. Votre équipe. », paragraphe, mention pour les particuliers, quatre pills de piliers, ligne « Photo • Vidéo • Contenu • Expérience joueur »). Droite : titre « Bienvenue sur Connect », sous-titre, champs e-mail et mot de passe (œil, `autocomplete`), « Mot de passe oublié ? », case « Rester connecté », bouton « Se connecter », séparateur « Pas encore de compte ? », « Créer mon compte », « Besoin d'aide ? ». Sous 900 px la colonne gauche disparaît, un header compact la remplace et la ligne des piliers passe sous le formulaire.
- **États** — validation par champ (bordure `#F472B6` + message), erreur d'authentification globale « Adresse e-mail ou mot de passe incorrect. », `Enter` valide, bouton en chargement (« Connexion… », spinner, double clic bloqué), succès avec deux sorties (espace joueur / espace particulier).
- **Mot de passe oublié** → confirmation d'envoi (« Vérifiez votre boîte mail », validité 30 minutes) → **nouveau mot de passe** (jauge de robustesse, confirmation) → **lien expiré** → **compte bloqué** après 3 échecs (déblocage 15 minutes, réinitialisation, contact).
- **Activation** — écran « Compte activé » avec continuation vers Connect.

Note de sécurité : ne jamais afficher d'erreur technique du fournisseur d'auth ; ne jamais révéler l'existence d'un compte sur l'écran de mot de passe oublié.

### Inscription (`Connect Inscription.dc.html`)

Quatre étapes avec barre de progression et fil d'Ariane (Compte · Profil · Sport · Club), état persisté en `localStorage` (clé `sv-connect-signup-v1`) pour reprendre un parcours interrompu.

1. **Identité** — prénom, nom, e-mail, mot de passe (jauge), confirmation. Gestion du cas « e-mail déjà utilisé » avec renvoi vers la connexion. Vérification d'e-mail avec renvoi temporisé 30 s, modification d'adresse, et état « lien expiré ».
2. **Profil** — Joueur / Sportif / Particulier / Parent-responsable légal / Autre (champ libre). Choix purement descriptif, aucun privilège.
3. **Sport** (joueur/sportif) — sport, poste conditionnel (football, futsal), catégorie, ville, photo facultative. Variante **Besoin** pour un particulier, variante **Parent** simplifiée.
4. **Club** — Oui / Autre (club non partenaire) / Non / Plus tard. Recherche de structure avec badges « ✓ Partenaire SportVision · Club+ » et « Non partenaire SportVision », gestion d'une demande déjà en attente, choix d'équipe, envoi de la demande, ou déclaration manuelle d'un club (nom, ville, équipe facultative) avec mention explicite que cela n'inscrit pas le club à Club+.

Sorties : demande envoyée (statut En attente, accès à Connect jamais bloqué), club déclaré, aucun club, et parcours d'invitation reçue d'un club (accepter / refuser) pour un compte existant.

### Espace joueur (`Connect Espace Joueur.dc.html`)

**Accueil** — hero « Bonjour Lucas 👋 » + « Retrouvez votre univers SportVision en un coup d'œil. », CTA « Réserver une prestation » (desktop). Grille 2 colonnes. Cartes affichées **uniquement si pertinentes** : club (affilié / en attente / aucun club avec carte d'onboarding), nouveaux contenus (2 covers), prochain événement (badge « 📸 SportVision présent »), cotisation en cours (montants, barre, partager/voir), prochaine prestation, messages non lus. Pas de raccourcis décoratifs, pas d'empty state empilés.

**Mes affiliations** — sections Affiliations actives / En attente / Clubs déclarés, menu par carte (modifier l'équipe, quitter, annuler la demande) avec confirmation, fiche d'affiliation (organisation, équipe, rôle, statut, date, partenaire ou non, contenus accessibles, événements liés, quitter). Parcours d'ajout : recherche → rejoindre (équipe + rôle Joueur) → demande envoyée ; ou déclaration manuelle.

**Mes équipes** — groupes personnels (monogramme, membres, tags cotisation/prestations, avatars empilés), création (nom obligatoire, description), page de groupe (membres, cotisations, prestations, actions Inviter / Réserver / Créer une cotisation), modale d'invitation (lien affiché, copier, WhatsApp, partage système, e-mail). Mention explicite : une cotisation finance uniquement une prestation SportVision.

**Prestations** — catalogue de 6 offres, filtres Tous / Match / Captation / Montage, prix TTC toujours visibles, mention « À 10 joueurs : X € / personne » sur les offres collectives. Fiche produit : hero, badges, prix dynamique, inclus, blocs Photo/Vidéo pour le pack, « Comment ça marche » en 3 étapes, option Photo (+60 €) pour Veo et Drone avec récapitulatif de prix immédiat, deux formats pour Highlight + devis au-delà de 4 matchs, bloc paiement collectif, mentions (frais de déplacement, disponibilité, faisabilité drone), FAQ, CTA sticky mobile « Réserver — X € ».

**Réservation** — wizard 4 étapes : informations du match (équipe, adversaire, date, heure, lieu, catégorie, notes) ou envoi de fichiers pour Highlight (limite du format bloquante), options, choix de paiement (payer seul / payer à plusieurs), paiement, confirmation « Demande enregistrée » au statut **En validation** avec mention des frais de déplacement. La commande créée apparaît immédiatement dans Mes commandes.

**Cotisations** — onglets En cours / Créées par moi / Mes participations / Terminées ; cartes avec progression financière et, séparément, le nombre de participations ou de contributions. Création en 4 étapes (prestation compatible, participants, répartition parts égales avec stepper ou participation libre, date limite, récapitulatif), écran de succès orienté partage, détail avec participants, actions Partager / Participer / Payer le reste, état « Objectif atteint ». Page publique séparée (`Connect Cotisation Publique.dc.html`) : participation sans compte (prénom, e-mail, montant), remerciement, incitation à créer un espace.

**Mes contenus** — onglets Tous / Photos / Vidéos / Reels / Favoris, albums par événement (badge Nouveau, compteurs), galerie (grille 2 colonnes mobile), favori au survol, lightbox plein écran (précédent/suivant, favori, téléchargement).

**Mes commandes** — filtres Toutes / En cours / À venir / Terminées / Annulées, cartes entièrement cliquables, fiche avec statut, date, lieu, rencontre, montant, mode de paiement, **timeline** En validation → Confirmée → Planifiée → En production → Livrée → Terminée (branche Annulée), section Livraison, documents liés, contact SportVision.

**Factures & paiements** — onglets Factures / Paiements, bandeau contextualisé pour un montant à régler (montant, prestation, échéance réelle, CTA Régler), lignes avec référence, montant, statut, PDF ou justificatif.

**Calendrier** — vues Mois / Semaine / Liste sur desktop, « À venir » par défaut sur mobile, groupes Cette semaine / Plus tard, badges par type (Match, Shooting, Prestation, Événement SportVision), fiche événement avec date, horaire, lieu, prestation et affiliation liées, « Ajouter à mon calendrier » (fichier .ics à générer, aucune promesse de synchronisation).

**Messages** — conversation unique « Équipe SportVision », deux colonnes desktop, liste puis conversation plein écran sur mobile, bulles, champ collant, pièce jointe. Aucun statut « en ligne ».

**Mon profil** — header compact (monogramme, sport, club, badge), Informations personnelles et Profil sportif éditables en modale, préférences de notifications (5 bascules), Mes affiliations (raccourci), **Accès à mon profil**, Sécurité (mot de passe), et Mes espaces uniquement si un accès Club+ existe.

**Accès à mon profil** — demandes en attente (nom, relation déclarée, message, aperçu des droits, Accepter / Refuser) et accès accordés (bascules par droit : voir les contenus, télécharger, réserver, suivre les commandes, voir les factures ; retrait de l'accès avec message clair). Une notification dédiée pointe vers cette page.

**Notifications**, **Recherche** (contenus, prestations, cotisations, équipes, affiliations — jamais de données Club+), **Aide** (FAQ, contact, problème de compte, messages).

### Espace particulier (`Connect Espace Particulier.dc.html`)

**Accueil** — « Bonjour Sophie 👋 », « Retrouvez les sportifs que vous accompagnez et leurs activités SportVision. », cartes sportifs (identité, sport, club, relation, statut d'accès, jusqu'à 3 faits), puis activité filtrée par le contexte actif : prochaine prestation, nouveaux contenus (badge « Pour Lucas »), prochain événement, cotisation, messages. Empty state « Ajoutez votre premier sportif » avec seconde voie « Réserver pour moi ».

**Mes sportifs** — liste, recherche au-delà de 3 sportifs (mode agent), cartes compactes, statuts Accès actif / Accès limité / Profil géré.

**Ajouter un sportif** — deux voies : *il possède déjà Connect* → invitation par e-mail + relation déclarée + message (aucun annuaire public) → demande en attente ; *il n'a pas de compte* → **profil géré** (prénom, nom, sport, catégorie, club, relation), sans adresse e-mail, avec mention de la validation juridique nécessaire.

**Fiche sportif** — header (identité, relation, statut), actions selon permissions (Réserver pour X, Ses contenus, Ses commandes), onglets Aperçu / Contenus / Prestations / Calendrier / Cotisations / **Accès & autorisations**. L'onglet des autorisations liste les 9 droits avec Autorisé / Non autorisé, rappelle que le lien déclaré ne donne aucun droit, et permet de retirer le sportif (relation supprimée, compte conservé).

**Réservation pour un sportif** — étape « Pour qui réservez-vous ? » (dont « Pour moi »), blocage explicite si la permission de réservation manque, puis match, option Photo, choix de paiement, récapitulatif distinguant **bénéficiaire / commanditaire / payeur**, confirmation En validation.

**Cotisation pour un sportif** — bénéficiaire, prestation compatible, groupe (équipe du club, proches, partage libre), stepper de participants avec part calculée, récapitulatif, lien de partage ; détail avec contributions.

**Listes multi-sportifs** — commandes, cotisations, contenus, calendrier (vues Liste / Mois sur desktop), factures : filtre par sportif dès qu'il y en a plusieurs, badge « Pour X » sur chaque ligne, factures rattachées au payeur.

**Messages contextualisés** — sélecteur « Ce message concerne : Mon compte / Lucas / Noah », en-tête reprenant le contexte.

**Mon profil** — informations personnelles éditables, notifications, Mes sportifs, Sécurité. Pas de section « profil sportif ».

## Interactions et comportements

- **Navigation** — un état de page unique par espace ; chaque navigation ferme les overlays, réinitialise la recherche et remonte en haut de page.
- **Overlays** — notifications, menu profil, sélecteur de contexte, invitation, participation, édition, confirmation, recherche mobile, lightbox. Desktop : panneaux ancrés en haut à droite (`sv-in`). Mobile : bottom sheets (`sv-sheet`). Clic sur le voile = fermeture.
- **Formulaires** — validation au premier envoi (`touched`), message sous le champ concerné, bordure d'erreur, CTA désactivé visuellement (opacité 0,45) tant que la condition n'est pas remplie, `Enter` valide les formulaires courts.
- **Chargement** — squelettes 700 ms à l'ouverture, spinner dans le bouton pour les actions, aucun spinner plein écran.
- **Erreur** — page d'erreur avec Réessayer et Contacter SportVision ; état hors ligne branché sur les événements `online` / `offline`.
- **Confirmations obligatoires** — quitter une affiliation, annuler une demande, retirer un sportif, retirer un accès.
- **Wording** — jamais « livrables » côté joueur (« contenus »), jamais de statut inventé, jamais « Confirmée » quand SportVision doit encore valider, jamais de compte à rebours artificiel.

## État à prévoir

| Domaine | État |
|---|---|
| Navigation | page courante, onglet actif par page, largeur de fenêtre (bascule à 860 px) |
| Session | utilisateur, espace actif (joueur / particulier), accès Club+ éventuel |
| Contexte particulier | sportif sélectionné (`all` ou identifiant) |
| Affiliations | liste, statuts, menu ouvert, fiche courante, formulaire de déclaration |
| Groupes | liste, groupe courant, formulaire de création, modale d'invitation |
| Catalogue | prestation courante, filtre, option Photo, format Highlight, fichiers envoyés, FAQ ouverte |
| Réservation | étape (1, 2, 3, 3.5, 4), champs du match, options, `touched` |
| Cotisations | liste, onglet, détail courant, étape de création, mode de répartition, nombre de participants, date limite, montant de participation |
| Contenus | onglet, album courant, favoris, index de lightbox |
| Commandes | onglet, commande courante, commandes créées dans la session |
| Documents | onglet |
| Messages | fil, brouillon, conversation ouverte (mobile), sujet (particulier) |
| Profil | informations, profil sportif, préférences de notifications, modale d'édition |
| Accès | demandes reçues, accès accordés et leurs droits |
| Global | phase (loading / ready / error), toast, recherche, overlays |

Persistance attendue : reprise du parcours d'inscription, préférences de notifications, dernier espace consulté. Rien d'autre ne doit être conservé côté client.

## Ce qui reste à brancher

| Sujet | Statut |
|---|---|
| Authentification, activation, réinitialisation | à connecter (l'UI couvre tous les états, y compris blocage après 3 échecs) |
| Paiements et remboursements | à connecter (aucun checkout réel dans le prototype) |
| Cotisations (calculs, échéances, relances) | logique à implémenter côté serveur ; l'UI attend une progression financière et un nombre de contributions distincts |
| Envoi d'e-mails | trois gabarits fournis dans `emails/`, à câbler et à héberger les images |
| Transfert de fichiers Highlight | UI prête (limites par format), transport à définir selon le backend existant |
| Documents (factures, devis, justificatifs) | génération et stockage à implémenter |
| Permissions d'accès | affichées et simulées ; l'application réelle doit être serveur, jamais côté client |
| Mineurs et profils gérés | vérification du responsable légal et conservation des données à valider juridiquement avant production |
| Reprise d'un profil géré par le sportif | parcours à concevoir (contenus, historique, affiliations doivent survivre) |
| Synchronisation calendrier | seul l'export .ics est promis ; ne pas annoncer de synchronisation temps réel |

## Assets

- `uploads/logo.png` — logo SportVision fourni par le client, fond transparent, utilisé à 26–38 px.
- Aucune photographie : tous les visuels sont des dégradés de remplacement. Les emplacements à remplir sont la colonne gauche de la connexion, les covers d'albums, les logos de clubs et les avatars.
- Icônes : Material Symbols Rounded (variable, `FILL` 0/1) chargée depuis Google Fonts.
- Polices : Sora, DM Sans, IBM Plex Mono (Google Fonts).

## Bibliothèque de composants

`Connect Design System.dc.html` (à copier dans ce dossier si absent) réunit couleurs, typographie, spacing/rayons, les 4 boutons, les champs (default/focus/error/disabled), le référentiel de badges, les 5 familles de cartes (Standard, Media, Action, Status, Progress) et les états obligatoires (loading, empty, error, success, disabled, permission denied). Ne créez aucune variante hors de cette page sans la mettre à jour.

## Matrice des redirections (extrait — couvre les CTA principaux)

| Page | Bouton / élément | Destination | Permission requise | État si indisponible |
|---|---|---|---|---|
| Connexion | Se connecter | Espace joueur ou particulier selon compte | — | Erreur inline ; blocage après 3 échecs |
| Connexion | Mot de passe oublié | Écran de réinitialisation | — | — |
| Accueil joueur | Réserver une prestation | `/prestations` | — | — |
| Accueil joueur | Carte club (aucun club) → Ajouter mon club | `/affiliations/ajouter` | — | — |
| Accueil joueur | Carte cotisation → Partager / Voir | share sheet / `/cotisations/:id` | — | masquée si aucune cotisation |
| Mes affiliations | Ajouter une affiliation | recherche → rejoindre ou déclarer | — | — |
| Mes affiliations | Quitter cette affiliation | confirmation → suppression de la relation | — | — |
| Mes équipes | Créer une cotisation (depuis un groupe) | `/cotisations/creer` avec groupe prérempli | — | — |
| Prestations | Réserver (carte) | `/prestations/:id` | — | — |
| Fiche prestation | Payer à plusieurs | `/cotisations/creer` avec prestation + montant préremplis | — | — |
| Réservation étape 3 | Payer | crée la commande, statut *En validation* | paiement | — |
| Commande | Voir mes livrables/contenus | `/contenus?album=:id` | `voir` (particulier) | action masquée si non autorisé |
| Commande | Facture de cette commande | `/factures?ref=:ref` | `factures` (particulier) | masquée si non autorisé |
| Cotisation détail | Participer | modale de participation → met à jour `collected` | — | masqué si `cdReached` |
| Cotisation détail | Payer le reste | disponible seulement si reste ≤ 48 € | — | masqué sinon |
| Cotisation détail (expirée) | Demander malgré tout / Rembourser | actions backend à connecter | créateur de la cotisation | — |
| Mes contenus | Album → Ouvrir | `/contenus/:albumId` → galerie → lightbox | `voir` (particulier) | — |
| Profil | Gérer mes affiliations / Mes sportifs | `/affiliations` ou `/athletes` | — | — |
| Profil | Accès à mon profil | `/acces` (joueur uniquement) | — | — |
| Accès à mon profil | Accepter / Refuser une demande | crée ou rejette la relation | — | — |
| Accès à mon profil | Bascule de droit / Retirer l'accès | met à jour les permissions serveur | — | confirmation obligatoire pour le retrait |
| Particulier · Accueil | Carte sportif → Voir | `/athletes/:id` | — | — |
| Particulier · Mes sportifs | Ajouter un sportif | invitation par e-mail ou profil géré | — | — |
| Particulier · Fiche sportif | Réserver pour X | `/prestations?benef=:id` | `reserver` | bloqué avec message si absent |
| Particulier · Accès & autorisations | Retirer ce sportif | confirmation → suppression de la relation | — | — |
| Topbar (les deux espaces) | `?` | `/aide` | — | — |
| Topbar (les deux espaces) | Recherche | résultats contenus/prestations/cotisations/équipes/affiliations | — | jamais de données Club+ |

Cette matrice est un extrait représentatif des CTA à plus fort enjeu (paiement, permissions, suppression). Le développeur doit compléter les lignes restantes en suivant le même gabarit à partir des fichiers `.dc.html` : chaque `onClick`/`href` du template correspond une ligne.

## Fichiers de ce dossier

| Fichier | Contenu |
|---|---|
| `Connect Prototype.dc.html` | index du prototype, parcours à tester, état d'avancement |
| `Connect Connexion Web.dc.html` | connexion, mot de passe oublié, nouveau mot de passe, lien expiré, activation, compte bloqué, aide |
| `Connect Inscription.dc.html` | inscription en 4 étapes, recherche de club, club déclaré, invitation reçue |
| `Connect Espace Joueur.dc.html` | l'espace joueur complet |
| `Connect Espace Particulier.dc.html` | l'espace parent / proche / agent complet |
| `Connect Cotisation Publique.dc.html` | page publique de participation à une cotisation |
| `Connect Emails.dc.html` | index des e-mails |
| `emails/*.html` | trois e-mails transactionnels prêts à envoyer |
| `Connect Directions.dc.html` | les deux directions visuelles comparées au départ |
| `uploads/logo.png` | logo |
| `support.js`, `image-slot.js` | runtime des prototypes — **à ne pas porter** |

Ouvrez les fichiers `.dc.html` dans un navigateur pour manipuler les écrans ; les valeurs de mise en forme sont lisibles directement dans les attributs `style` du HTML.
