# Inventaire des actions — SportVision Connect

Chaque bouton et chaque zone cliquable, avec sa cible, son effet et sa condition d'affichage.

- **Type** — principal, secondaire, discret, destructif, lien, ligne cliquable, carte
- **Effet** — navigation, ouverture de panneau, appel serveur, changement d'état
- **Condition** — ce qui doit être vrai pour que l'élément apparaisse ou soit actif

---

## 1. Accès et connexion

### `/auth/login`

| Élément | Type | Effet | Condition |
|---|---|---|---|
| Champ e-mail, mot de passe | Saisie | état local | — |
| Œil afficher/masquer | Icône | bascule `password → text` | — |
| Se souvenir de moi | Case | persisté | — |
| Mot de passe oublié | Lien | → `/auth/forgot` | — |
| **Se connecter** | Principal | `POST /auth/login` → `/dashboard`, ou `/auth/mfa` si MFA actif | champs remplis |
| Continuer avec Google | Secondaire | OAuth → `/dashboard` | intégration active |
| Créer mon espace | Lien | → `/signup/type` | — |
| Contacter SportVision | Lien | → formulaire public | — |

Erreur : bandeau rouge « Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de
passe. » Ne jamais préciser lequel des deux est faux.

### Autres écrans d'accès

| Route | Élément principal | Effet | Notes |
|---|---|---|---|
| `/auth/forgot` | **Envoyer le lien** | `POST /auth/password-reset` → `/auth/verify` | réponse identique que le compte existe ou non |
| `/auth/verify` | Renvoyer l'e-mail | limité à 1/minute | lien valable 24 h |
| `/auth/mfa` | **Vérifier** | `POST /auth/mfa/verify` → `/dashboard` | 6 champs, avance auto, collage réparti ; lien « code de secours » |
| `/auth/invite/:token` | **Rejoindre \<organisation\>** | `POST /auth/accept-invite` → onboarding réduit | valable 7 jours, rôle non modifiable par l'invité |
| `/auth/suspended` | **Régulariser le paiement** | règlement Stripe | + « Contacter SportVision » |
| `/auth/invite-expired` | **Demander une nouvelle invitation** | notifie l'administrateur | — |

---

## 2. Inscription — 7 étapes

Barre de progression + frise numérotée. Étapes franchies en vert, courante en dégradé principal.

| Étape | Élément | Effet |
|---|---|---|
| 1 · Structure | 6 cartes : Club, Académie, Coach, Joueur, Autre structure sportive, Événement | fixe `orgType`, conditionne toute la suite |
| 1 · Affiliation | **Si Joueur** : gérer mon espace moi-même / rejoindre un club sur Connect | un joueur affilié saute le choix d'offre et le paiement |
| 2 · Vous | Prénom, Nom, E-mail, Téléphone, Fonction, Mot de passe | jauge de robustesse, unicité e-mail vérifiée |
| 3 · Organisation | Logo, Nom, Adresse, Instagram, SIRET | libellés adaptés au type |
| 3 | Nombre d'équipes, de licenciés | **uniquement** si Club ou Académie |
| 4 · Besoins | 8 cases à cocher + texte libre | transmis au conseiller |
| 5 · Offre | Cartes radio **filtrées par type** | club et académie voient les 4 offres, un coach 3, un joueur 2, un événement 2 |
| 5 · Club | **Si joueur affilié** : recherche de club au lieu du choix d'offre | accès financé par le club |
| 6 · Paiement | Récapitulatif 6 lignes | dérivé du catalogue |
| 6 | Carte, Expiration, CVC | **si l'offre n'est pas Full Communication** |
| 6 | Message de mise en relation | **si Full Communication** → aucun paiement |
| 6 | Demande de rattachement | **si joueur affilié** → aucun paiement, validation par un administrateur du club |
| 6 | **Valider et payer** / **Envoyer ma demande de devis** | crée tout → étape 7 |
| 7 · Confirmation | **Accéder à mon espace** | → `/onboarding` |
| Toutes | Retour, J'ai déjà un compte | saisies conservées |

**Effets serveur à l'étape 6** — organisation, utilisateur propriétaire, abonnement Stripe (hors
Full Communication), contrat généré et envoyé pour signature, conseiller assigné, e-mail de
vérification.

---

## 3. Onboarding — 10 étapes

Trois parcours selon l'offre.

**Générique — 10 étapes** · Bienvenue · Informations · Organisation · Abonnement · Logo ·
Invitations · Réseaux · Tableau de bord · Première demande · Validation.

**Club+ — 8 étapes** · Bienvenue dans Club+ · Votre club · Logo et couleurs · Vos équipes ·
Votre staff · Vos sponsors · Votre brand kit · Tout est prêt.

**Full Communication — 9 étapes** · Bienvenue · Votre structure · Vos objectifs · Vos réseaux ·
Votre identité · Vos équipes et sponsors · Votre calendrier · Vos attentes · Votre Community
Manager prépare votre stratégie.

| Élément | Type | Effet |
|---|---|---|
| **Continuer** | Principal | étape suivante, progression enregistrée |
| Retour | Secondaire | étape précédente |
| Terminer plus tard | Discret | ferme, mémorise l'étape atteinte |
| **Accéder à mon tableau de bord** | Principal | étape 10 → `/dashboard` |

**Reprise** — bandeau sur le tableau de bord si interrompu avant l'étape 10 : progression,
**Reprendre** et **Plus tard**.
**Rejouer** — entrée « Revoir le tutoriel de bienvenue » dans le centre d'aide.

---

## 3 bis. Deux conventions à respecter partout

**Messages** = messagerie contextuelle, rattachée à un objet. **Aide** = documentation, guides,
tickets. Les deux sont nommés ainsi dans les 14 navigations, jamais « Support ».

**Aucune entrée « Vue mobile ».** Les maquettes mobiles sont un outil de revue, atteintes par une
icône de la barre supérieure. Ne pas reconstruire cette rubrique.

## 4. Chrome permanent

### Barre latérale

| Élément | Type | Effet | Condition |
|---|---|---|---|
| Logo | Lien | → `/dashboard` | — |
| Sélecteur d'organisation | Bouton | déplie la liste | — |
| Ligne d'organisation | Ligne cliquable | recharge navigation, permissions, données, modules → `/dashboard` | — |
| Voir toutes mes organisations | Discret | → liste complète | plus de 5 organisations |
| Titre de section | Statique | non cliquable | entrée `['§', label]` |
| Entrée de navigation | Bouton | → route | visible ; cadenas si `!canAccess` |
| Badge de compteur | Indicateur | éléments en attente | compteur > 0 |
| **Gérer mon offre** | Bouton sur carte | → `/billing` | — |
| Aide & support | Discret | → `/support` | — |
| Avatar + nom | Bloc | → `/settings/profile` | — |
| Déconnexion | Icône | `POST /auth/logout` → `/auth/login` | — |

Le sélecteur affiche par organisation : logo, nom, type, rôle, statut d'abonnement, point orange
si une action urgente y attend. Pour un joueur rattaché, le club parent apparaît en dessous.

### Barre supérieure

| Élément | Type | Effet |
|---|---|---|
| Fil d'Ariane + titre | Texte | contextuel |
| Recherche globale | Saisie | panneau de résultats groupés à la première frappe |
| Résultat | Ligne cliquable | → l'élément |
| **Nouvelle demande** | Principal | modale de demande de visuel |
| Notifications | Icône + badge | panneau des 5 dernières |
| Tout marquer comme lu | Discret | `PATCH /notifications/read-all` |
| Ouvrir le centre de notifications | Pied de panneau | → `/notifications` |
| Aperçu mobile | Icône | maquettes mobiles → **outil de revue, hors produit** |
| Bascule de thème | Icône | clair → sombre, persisté |
| Aide | Icône | → `/support` |
| Avatar | Icône | → `/settings/profile` |

Recherche limitée à l'espace actif, groupée par : Contenus, Demandes, Prestations, Équipes et
joueurs, Documents et factures.

---

## 5. Tableaux de bord

### Club+ (Club+ Start, Club+ Performance)

| Élément | Type | Effet |
|---|---|---|
| Voir le calendrier | Secondaire | → `/calendar` |
| **Demander une prestation** | Sombre | tunnel 5 étapes |
| Gérer l'offre | Sur carte premium | → `/billing` |
| 6 actions rapides | Cartes | Demander un visuel · Demander une prestation · Importer un document · Consulter les contenus · Ajouter un événement · Inviter un utilisateur |
| Ligne « À traiter » | Secondaire | Valider · Payer · Signer · Compléter · Relancer selon le type |
| Carte de prestation | Carte | → `/services/:id` |
| Vignette de contenu | Carte | fiche média |

Carte d'offre : 3 jauges dérivées du catalogue (crédits, présences, stockage).

### Full Communication

| Élément | Type | Effet |
|---|---|---|
| **Voir ce qui attend ma validation** | Principal | → `/validations` |
| Carte de la semaine (×4) | Statistique | publications programmées, contenu à valider, présence, rapport |
| Ligne « Ce que nous préparons » | Ligne | → la publication |
| Planning complet | Discret | → `/communication` |
| **Envoyer un message** (carte CM) | Sur bloc premium | → `/mycm` |
| **Lire le rapport** | Secondaire | → `/reports` |
| **Transmettre une information** | Principal | modale de transmission |
| Écrire à Nina | Secondaire | → `/messages` |

Le titre et le contenu varient par type : club, coach (« Développez votre image
professionnelle »), académie (« Pilotez le calendrier de votre académie »), événement
(« Elite Cup 2026 — J-18 avant l'événement »).

### Joueur, Parent, CM externe, Client ponctuel

Même ossature : bandeau héros contextuel, 3 jauges, liste prioritaire, liste secondaire, derniers
contenus. Le joueur affilié affiche « CLUB ABONNÉ », l'indépendant « SANS CLUB » avec « Partager
mon book ».

---

## 6. Studio Club+ — `/studio`

| Élément | Type | Effet | Condition |
|---|---|---|---|
| Recherche | Saisie | filtre les modèles à la frappe | — |
| Filtre de catégorie | Puce | Tout · Avant-match · Jour de match · Après-match · Joueurs · Vie du club · Sponsors · Événements | — |
| Carte de modèle | Carte | → fiche du modèle | `canAccess('studio')` |

**47 modèles.** Avant-match : Matchday, Affiche de rencontre, Convocation, Groupe convoqué,
Programme du week-end, Programme mensuel, Annonce de déplacement. Jour de match : Starting XI,
Composition, Remplaçants, Coup d'envoi, Score en direct, Mi-temps, Buteur. Après-match : Résultat,
Victoire, Défaite, Match nul, Homme du match, Statistiques, Classement. Joueurs : Anniversaire,
Signature, Prolongation, Nouvelle recrue, Présentation, Départ, Sélection, Récompense. Vie du
club : Communiqué, Recrutement joueurs, Détection, Stage, Horaires, Portes ouvertes, Recrutement
éducateurs. Sponsors : Nouveau partenaire, Sponsor du match, Présentation, Remerciement, Offre,
Anniversaire de partenariat. Événements : Tournoi, Loto, Soirée du club, Soirée partenaires,
Remise de trophées.

### Fiche modèle

| Élément | Type | Effet |
|---|---|---|
| Retour au Studio | Discret | → `/studio` |
| Aperçu + 3 exemples | Statique | réalisations pour d'autres clubs |
| Bloc « Prérempli automatiquement » | Statique | club, logo et couleurs, sponsors, saison |
| Équipe, Adversaire, Compétition, Date, Lieu, Sponsor, Photo, Commentaire | Saisie | — |
| Bandeau de coût | Statique | « Cette création utilisera N crédits · livraison sous X · il vous restera Y » |
| **Envoyer ma demande** | Principal | décompte les crédits, crée la demande → `/requests`, toast |
| Enregistrer en brouillon | Secondaire | sauvegarde sans décompte |

---

## 7. Newsroom — `/newsroom`

| Élément | Type | Effet |
|---|---|---|
| Filtre | Puce | Tout · Reçu · À traiter · Transformé · Archivé |
| **Transformer en publication** | Principal | → Studio, modèle présélectionné |
| Créer une demande | Secondaire | modale de demande de visuel |
| Demander un complément | Discret | notifie l'auteur de la remontée |
| Archiver | Discret | passe en `Archivé` |

Chaque entrée affiche : titre, auteur et équipe, date, statut, corps du message.

## 8. Match Center — `/matchcenter`

| Élément | Type | Effet |
|---|---|---|
| Onglets | Onglet | À venir · À transmettre · Reçus · Contenus créés |
| **Saisir un résultat** | Principal | formulaire express 3 champs |
| Créer le visuel | Secondaire | → Studio, modèle Résultat |

Formulaire express : score, buteurs, homme du match. Formulaire complet : 14 champs.

---

## 9. Full Communication

### `/validations`

| Élément | Type | Effet |
|---|---|---|
| **Valider** | Dégradé validation | contenu validé, part en programmation |
| Demander une correction | Secondaire | retour au studio, compteur +1 |
| Voir en grand | Discret | aperçu plein écran |

Chaque carte : aperçu, badge d'urgence, auteur, format, date de publication prévue.

### `/publications`

Tableau : publication, plateforme, date, statut, portée, interactions. Statuts visibles : Publiée,
À valider, En préparation, Erreur de publication. **Aucun détail technique Metricool.**

### `/presences`

| Élément | Type | Effet |
|---|---|---|
| **Demander une présence** | Sur bandeau premium | tunnel de prestation |
| Ligne de présence | Ligne | date, événement, type, opérateur si autorisé, statut |

Bandeau : « N présences réalisées sur M » + jauge, pour le mois en cours.

### `/analytics`

4 métriques seulement : portée, vues, engagement, abonnés — chacune avec sa progression.
Puis « Vos meilleures publications » : 3 entrées avec portée et interactions.

### `/reports`

| Élément | Type | Effet |
|---|---|---|
| Carte de mois | Carte | charge le rapport |
| **Télécharger le rapport** | Sur en-tête premium | PDF |

Sections : Résumé du mois · Objectifs · Contenus réalisés · Meilleure publication ·
Recommandations · Plan du mois suivant.

### `/mycm`

| Élément | Type | Effet |
|---|---|---|
| **Envoyer un message** | Principal | → `/messages`, fil du CM |
| Planifier un échange | Secondaire | créneaux disponibles |

Carte : photo, nom, rôle, indicateur de disponibilité, contenus produits, délai de réponse,
prochain point. Puis « Comment travailler ensemble » en 3 points.

---

## 10. Espaces spécifiques

### Coach Full Com — `/sessions`

Liste des séances : date et heure, intitulé, lieu, statut (Captation prévue, Confirmée, À
confirmer). **Ajouter une séance** en principal.

### Académie Full Com — `/camps`

Cartes de stage : nom, dates, lieu, groupes, jauge d'inscriptions, statut. **Créer un stage** en
principal.

### Tournoi Full Com — `/eventtimeline`

Trois phases, chacune avec sa date, son statut et ses items :

| Phase | Items |
|---|---|
| Avant l'événement | Teasing · Présentation des équipes · Mise en avant des sponsors · Informations pratiques |
| Jour J | Stories en direct · Résultats en temps réel · Photos d'action · Clips et temps forts |
| Après l'événement | Galerie complète · Aftermovie · Remerciements partenaires · Rapport |

### Tournoi Full Com — `/live`

4 statistiques du jour + fil horodaté des publications sorties. **Voir la galerie** en secondaire.

---

## 11. Demandes de visuels — `/requests`

| Élément | Type | Effet |
|---|---|---|
| **Nouvelle demande de visuel** | Principal | modale |
| Filtre | Puce | Toutes · À valider · En création · Livrées · Brouillons |
| Filtres / Colonnes / Exporter | Secondaire | filtres avancés, colonnes configurables, export CSV |
| Case d'en-tête / de ligne | Case | sélection multiple |
| Valider la sélection | Principal (barre) | validation en lot, dès 1 sélection |
| Action de ligne | Secondaire | Valider · Suivre · Ouvrir · Télécharger selon le statut |
| Pagination | Boutons | — |

### Modale de demande

11 types de visuel · Équipe, Événement, Date, Format et plateforme · Texte à intégrer · Zone de
dépôt · 3 urgences (Standard 5 j / 1 crédit, Prioritaire 48 h / 2, Express 24 h / 3).
Panneau de récapitulatif recalculé en direct : type, urgence, délai, crédits nécessaires,
disponibles, solde restant.
**Envoyer la demande** (décompte + toast) · Enregistrer en brouillon.

---

## 12. Prestations — `/services`

Kanban et Liste. Colonnes : Demande reçue, À valider, Devis envoyé, Planifiée, Postproduction,
Livrée.

### Tunnel — 5 étapes

1. 11 types de prestation
2. Date, Horaires, Adresse, Équipe, Contact sur place, Besoins spécifiques
3. 7 options — Drone +250 € · Reel +180 € · Highlight +220 € · Express 48 h +150 € ·
   Photographe +320 € · Interview +140 € · Stories +110 €
4. Tarification : forfait, options, remise liée à l'offre, déplacement, total, acompte 30 %
5. Récapitulatif + conditions

### Fiche prestation — 10 onglets

| Onglet | Actions |
|---|---|
| Résumé | — |
| Planning | déroulé heure par heure |
| Équipe | intervenants des deux côtés |
| Brief | Proposer une modification |
| Fichiers | Ajouter un fichier · Télécharger |
| Livrables | — |
| Validation | **Confirmer les horaires** |
| Facturation | Voir la facture d'acompte · Télécharger le devis signé |
| Historique | — |
| Messages | Envoyer |

En-tête : **Confirmer les horaires** + Ajouter au calendrier.

---

## 13. Bibliothèque — `/content` et `/media`

| Élément | Type | Effet |
|---|---|---|
| Créer une collection | Secondaire | modale |
| **Tout télécharger** | Sombre | archive, lien par e-mail |
| Carte de collection | Carte | panneau de collection |
| Filtre de type | Puce | Tous · Photos · Vidéos · Reels · Affiches · Documents |
| Grille / Liste | Puce | bascule |
| Vignette | Carte | fiche média |

Contexte : **joueur** → « Mes contenus », collections masquées, bandeau explicatif.
**Coach** → « Contenus de mes joueurs ».

### Panneau de collection
Partager par lien (30 jours, toast) · **Tout télécharger** · vignettes cliquables.

### Fiche média

Lecture · barre de progression avec pastilles de commentaire · Chapitres · sélecteur de version ·
commentaire horodaté + Publier · **Valider** · Demander une correction · **Télécharger** ·
Partager par lien sécurisé.
Deux corrections incluses, la troisième facturée.

---

## 14. Communication — `/communication`

Mois / Semaine / Liste · **Ajouter une publication** · glisser-déposer en mois et semaine ·
carte de file de publication → fiche.

### Fiche publication
Frise de 8 statuts · **Valider la publication** · Demander une correction · commentaires ·
historique · texte, hashtags, 6 informations.

---

## 15. Calendrier — `/calendar`

Mois / Semaine / Jour / Liste · Exporter (iCal) · **Ajouter un événement** · clic sur un événement
→ fiche latérale.

Fusionne : matchs, entraînements, prestations, tournages, réunions, publications, échéances de
contrat, factures, événements, stages, tournois.

---

## 16. Équipes — `/teams`

Cartes d'équipe → fiche à 6 onglets : Aperçu · Effectif · Calendrier · Contenus · Demandes ·
Documents.
En-tête : Exporter l'effectif · **Ajouter un joueur**.

Pour un **CM externe**, `/teams` devient « Clubs suivis » : 4 statistiques + une carte par club
avec publications, à valider, jauge d'avancement, statut d'accès et **Ouvrir le planning**.

### Fiche joueur
Demander un visuel · **Relancer** si autorisation manquante · vignettes de contenus.
Bandeau vert si l'autorisation est signée, orange sinon avec « Les contenus de ce joueur ne sont
pas publiables ».

---

## 17. Sponsors — `/sponsors`

4 statistiques + cartes avec jauge de visibilité → fiche à 4 onglets : Livrables · Contrat ·
Publications · Documents. Exporter le bilan.

---

## 18. Contrats — `/contracts`

Bandeau premium : durée d'engagement, préavis, mensualité, renouvellement, fin.
**Signer l'avenant** · Ouvrir → fiche : 8 conditions, 5 points « À retenir », échéancier, aperçu
PDF, **Signer avec Yousign** (lien 8 jours), Voir les annexes.

---

## 19. Factures — `/billing`

3 cartes : facture en retard (rouge), prochaine mensualité, moyen de paiement (4 derniers
chiffres).
**Payer maintenant** · Voir l'échéancier · Gérer le moyen de paiement · Ouvrir → fiche.

### Fiche facture
Télécharger le PDF · **Payer \<montant\>** si À payer ou En retard · **Télécharger le reçu** si
Payée. Lignes détaillées, totaux HT/TVA/acompte. Le libellé du total s'adapte : « Net à payer »,
« Montant réglé », « Montant estimé ».

---

## 20. Parent — `/children` et `/authorizations`

### Profils associés
Une carte par enfant : nom, âge, équipe, numéro, poste, entraîneur, contenus, statut du droit à
l'image. **Voir ses contenus** et **Réserver une prestation** si l'autorisation est signée.
Bandeau d'alerte si une autorisation manque.

### Autorisations
Documents par enfant avec action attendue (Télécharger, Signer, Déposer).
Étendue du droit à l'image en 5 interrupteurs : Photos d'équipe et de match · Vidéos et
highlights · Portraits individuels · Usage commercial · Diffusion hors club.
Mention RGPD : retrait des contenus publiés traité sous 72 heures.

---

## 20 bis. Sponsor — `/sponsors` (espace partenaire)

Un partenaire dispose de son propre espace, séparé de celui du club.

| Élément | Type | Effet |
|---|---|---|
| Jauge de visibilité | Statistique | livrables réalisés sur prévus |
| Contenus sponsorisés | Carte | publications où son logo apparaît |
| Opérations | Ligne | activations prévues et réalisées |
| Contrat et documents | Secondaire | téléchargement |
| Messages | Principal | fil avec le club et SportVision |

Il ne voit **ni** les équipes, **ni** les factures du club, **ni** les demandes.

## 20 ter. Structure sportive générique

Ligue, comité, association, entreprise sportive. Navigation réduite aux prestations, demandes,
contenus, calendrier, documents, factures, utilisateurs et messages. Aucun outil Club+ ni Full
Communication tant que l'offre ne les débloque pas. Ce type existe aussi à l'inscription.

## 21. Accompagnement — `/accompagnement`

**Client** — 4 cartes d'inclusions dérivées du catalogue · « Qui intervient pour vous » (chargé de
compte, studio, CM) avec Contacter · Points de suivi mensuels · Le mois en cours en 4 chiffres ·
Gérer mon offre · **Parler à mon conseiller**.

**CM externe** — « Mes accès délégués » : une carte par club avec périmètre, ce qui est autorisé,
ce qui ne l'est pas, date d'expiration, **Ouvrir**.

---

## 22. Messagerie — `/messages`

Deux panneaux. À gauche, la liste des conversations avec recherche, avatar, indicateur de
présence, contexte, dernier message, badge de non-lus. À droite, le fil.

| Élément | Type | Effet |
|---|---|---|
| Conversation | Ligne cliquable | charge le fil |
| Joindre un fichier / une image | Icône | upload |
| **Envoyer** | Principal | poste le message |
| Options (···) | Icône | archiver, marquer non lu |

Chaque conversation est rattachée à son objet : Communication, une prestation, la facturation, une
demande, le support. **Pas de fil générique.** Indicateur « Vu par X ».

---

## 23. Notifications — `/notifications`

Préférences · **Tout marquer comme lu** · filtres par catégorie · Ouvrir → l'élément.
Regroupement par jour. Non lues sur fond teinté avec point bleu. Badge « IMPORTANT » sur les
épinglées.

### Modale de préférences
Par catégorie : bascule e-mail, bascule application, fréquence (Immédiat · Résumé quotidien ·
Résumé hebdomadaire · Jamais). Heures calmes : pas avant 08h00, pas après 21h00, dimanche en
urgences uniquement. **Les notifications critiques sont toujours envoyées.**

---

## 24. Support — `/support`

Recherche · cartes de sujet · **Revoir le tutoriel de bienvenue** (rouvre l'onboarding) ·
**Nouveau ticket** · **Le contacter** vers le chargé de compte · indicateur d'état des services.

---

## 25. Paramètres — `/settings`

**Personnel** — photo, nom, téléphone, e-mail, langue, **Activer** la double authentification,
**Apparence sombre** (interrupteur), Enregistrer.
**Organisation** — logo, nom, adresse, Instagram, SIRET, couleurs du club.
**Intégrations** — 6 services (Google Calendar, Instagram, TikTok, Meta Business, WhatsApp,
Stripe) avec état, compte lié, dernière synchronisation, **Connecter / Reconnecter**.

### Panneau de synchronisation
**Synchroniser maintenant** · Déconnecter · autorisations demandées (avec la mention explicite que
la suppression d'événements n'est **pas** demandée) · table de correspondance des calendriers ·
historique.

---

## 26. Module verrouillé

Affiché sur toute route dont `canAccess` retourne faux.
Parler à mon conseiller → `/support` · **Découvrir les offres** → `/billing`.

> Ce module n'est pas activé sur votre contrat actuel (\<offre\>). Votre interlocuteur SportVision
> peut l'ajouter à tout moment.

---

## 26 bis. Récapitulatif — ce qui est prêt à développer

| Domaine | État |
|---|---|
| Écrans | 34 écrans, 33 clés de navigation, aucune orpheline |
| Boutons | 91 gestionnaires, tous câblés, aucun clic mort |
| Espaces | 13 profils avec navigation, dashboard et permissions propres |
| Offres | 6 entrées de catalogue, source de vérité unique |
| Onboardings | 3 parcours : générique 10 étapes, Club+ 8, Full Communication 9 |
| Inscription | 7 étapes, offres filtrées par type, parcours joueur affilié |
| Statuts | 8 chaînes d'états, dont crédits réservés puis consommés |
| Thèmes | Sombre par défaut, clair complet, tokens partagés |
| Responsive | 5 points de rupture, tableaux en cartes sous 760 px |
| E-mails | 8 transactionnels sur un gabarit unique |

**Non fourni par le client** — tarifs mensuels (seul Full Communication sur devis est confirmé) et
photographies. Tous les emplacements visuels sont des placeholders identifiés.

## 27. E-mails transactionnels

| Déclencheur | Objet | Action principale | Secondaire |
|---|---|---|---|
| Contenu livré | Votre affiche Matchday est prête à être validée | Valider le contenu | Demander une correction |
| Facture échue J+3 | Facture SV-2026-XXXX — échue depuis 3 jours | Payer la facture | Voir la facture |
| Contrat envoyé | Votre contrat \<offre\> attend votre signature | Signer avec Yousign | Lire le contrat |
| Prestation planifiée | \<Prestation\> confirmé — \<date\> | Voir la prestation | Ajouter à mon calendrier |
| Contenus livrés | \<N\> photos disponibles — \<événement\> | Ouvrir la galerie | Tout télécharger |
| Invitation | \<Nom\> vous invite à rejoindre \<organisation\> | Créer mon mot de passe | — |
| Correction demandée | Correction demandée sur \<contenu\> | Voir la demande | — |
| Crédits presque épuisés | Il vous reste \<N\> crédits visuels ce mois-ci | Gérer mon offre | Contacter mon conseiller |

Pied de chaque e-mail : organisation concernée, lien vers les préférences, centre d'aide, Connect,
mention de non-réponse. Bloc signature avec l'interlocuteur assigné.
