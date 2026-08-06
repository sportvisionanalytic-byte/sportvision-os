# Inventaire des actions — SportVision Connect

Chaque bouton et chaque zone cliquable de la maquette, avec sa cible, son effet et sa condition
d'affichage. C'est le document à suivre pour câbler l'application.

Colonnes :

- **Élément** — le libellé exact affiché
- **Type** — bouton principal, secondaire, discret, lien, ligne cliquable, carte
- **Effet** — navigation, ouverture de panneau, appel serveur, changement d'état local
- **Condition** — ce qui doit être vrai pour que l'élément apparaisse ou soit actif

---

## 1. Accès et connexion

### `/auth/login`

| Élément | Type | Effet | Condition |
|---|---|---|---|
| Champ e-mail | Saisie | `email` local | — |
| Champ mot de passe | Saisie | `password` local, masqué | — |
| Œil afficher/masquer | Icône | bascule `type=password → text` | — |
| Se souvenir de moi | Case | `remember` local, persisté | — |
| Mot de passe oublié | Lien | → `/auth/forgot` | — |
| **Se connecter** | Principal | `POST /auth/login` → `/dashboard`, ou `/auth/mfa` si MFA actif | e-mail et mot de passe non vides |
| Continuer avec Google | Secondaire | OAuth Google → `/dashboard` | intégration Google activée |
| Créer mon espace | Lien | → `/signup/type` | — |
| Contacter SportVision | Lien | → formulaire de contact public | — |

**Erreur de connexion** — bandeau rouge `#FEF3F2` / bordure `#FDA29B` / texte `#B42318` au-dessus
du formulaire : « Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de passe. »
Ne jamais préciser si c'est l'e-mail ou le mot de passe qui est faux.

### `/auth/forgot`

| Élément | Type | Effet |
|---|---|---|
| Champ e-mail | Saisie | — |
| **Envoyer le lien** | Principal | `POST /auth/password-reset` → `/auth/verify` |
| Revenir à la connexion | Secondaire | → `/auth/login` |

Réponse toujours identique, que le compte existe ou non.

### `/auth/verify`

| Élément | Type | Effet |
|---|---|---|
| Renvoyer l'e-mail | Secondaire | `POST /auth/resend-verification`, limité à 1 par minute |
| Recommencer | Lien | → `/auth/login` |

Lien de confirmation valable **24 heures**.

### `/auth/mfa`

| Élément | Type | Effet |
|---|---|---|
| 6 champs de code | Saisie | 1 caractère chacun, avance automatique, collage réparti |
| **Vérifier** | Principal | `POST /auth/mfa/verify` → `/dashboard` |
| Renvoyer le code | Lien | `POST /auth/mfa/resend` |
| Utiliser un code de secours | Lien | → saisie de code de secours |

### `/auth/invite/:token`

| Élément | Type | Effet |
|---|---|---|
| Mot de passe + confirmation | Saisie | jauge de robustesse en 4 segments |
| **Rejoindre \<organisation\>** | Principal | `POST /auth/accept-invite` → onboarding réduit |

Lien valable **7 jours**. Le rôle proposé est affiché et non modifiable par l'invité.
Si le token est périmé → `/auth/invite-expired`.

### `/auth/suspended`

| Élément | Type | Effet |
|---|---|---|
| **Régulariser le paiement** | Destructif | → règlement Stripe de la facture en retard |
| Contacter SportVision | Secondaire | → support |

### `/auth/invite-expired`

| Élément | Type | Effet |
|---|---|---|
| **Demander une nouvelle invitation** | Principal | notifie l'administrateur de l'organisation |
| Revenir à la connexion | Secondaire | → `/auth/login` |

---

## 2. Inscription — 7 étapes

Barre de progression en haut, plus une frise des 7 étapes numérotées. Les étapes franchies passent
en vert `#12B76A`, l'étape courante en dégradé principal, les suivantes en `#EDF0F7`.

| Étape | Élément | Effet |
|---|---|---|
| 1 · Structure | 5 cartes : Club, Académie, Coach, Joueur, Événement | fixe `orgType`, qui conditionne toute la suite |
| 1 | **Continuer** | → étape 2 |
| 1 | Revenir à la connexion | → `/auth/login` |
| 2 · Vous | Prénom, Nom, E-mail, Téléphone, Fonction, Mot de passe | validation à la volée, jauge de robustesse |
| 2 | **Continuer** | vérifie l'unicité de l'e-mail côté serveur, puis → étape 3 |
| 3 · Organisation | Zone de dépôt du logo | upload, PNG/SVG, fond transparent recommandé |
| 3 | Nom, Adresse, Instagram, SIRET | libellés adaptés au type choisi |
| 3 | Nombre d'équipes, Nombre de licenciés | **uniquement** si Club ou Académie |
| 3 | **Continuer** | → étape 4 |
| 4 · Besoins | 8 cases à cocher | multi-sélection, transmise au conseiller |
| 4 | Zone de texte libre | commentaire |
| 4 | **Continuer** | → étape 5 |
| 5 · Offre | 4 cartes radio | l'offre sélectionnée déplie ses inclusions |
| 5 | **Continuer** | → étape 6 |
| 6 · Paiement | Récapitulatif en 6 lignes | dérivé du catalogue d'offres |
| 6 | Carte, Expiration, CVC | **si l'offre n'est pas Full Communication** |
| 6 | Message de mise en relation | **si Full Communication** — aucun paiement demandé |
| 6 | Acceptation des CGV | case obligatoire |
| 6 | **Valider et payer** / **Envoyer ma demande de devis** | crée l'organisation, l'abonnement Stripe, le contrat → étape 7 |
| 7 · Confirmation | 4 prochaines actions | informatif |
| 7 | **Accéder à mon espace** | → `/onboarding` |
| Toutes | Retour | → étape précédente, saisies conservées |
| Toutes | J'ai déjà un compte | → `/auth/login` |

**Effets serveur à l'étape 6** — création de l'organisation, de l'utilisateur propriétaire, de
l'abonnement Stripe (hors Full Communication), génération du contrat et envoi pour signature,
assignation d'un conseiller SportVision, envoi de l'e-mail de vérification.

---

## 3. Onboarding — 10 étapes

Étapes : Bienvenue · Informations personnelles · Organisation · Abonnement · Logo · Invitations ·
Réseaux sociaux · Tableau de bord · Première demande · Validation.

| Élément | Type | Effet |
|---|---|---|
| **Continuer** | Principal | étape suivante, progression enregistrée |
| Retour | Secondaire | étape précédente |
| Terminer plus tard | Discret | ferme l'onboarding, mémorise l'étape atteinte |
| **Accéder à mon tableau de bord** | Principal | étape 10 uniquement → `/dashboard` |

**Reprise** — si l'onboarding a été interrompu avant l'étape 10, le tableau de bord affiche un
bandeau « Votre installation n'est pas terminée » avec la progression, plus deux boutons :
**Reprendre** (rouvre à l'étape atteinte) et **Plus tard** (masque le bandeau pour la session).

**Rejouer** — entrée « Revoir le tutoriel de bienvenue » dans le centre d'aide, rouvre à l'étape 1.

---

## 4. Chrome permanent

### Barre latérale

| Élément | Type | Effet | Condition |
|---|---|---|---|
| Logo SportVision Connect | Lien | → `/dashboard` | — |
| Sélecteur d'organisation | Bouton | déplie la liste des organisations | — |
| Ligne d'organisation | Ligne cliquable | change d'organisation : recharge navigation, permissions, données, modules → `/dashboard` | — |
| Voir toutes mes organisations | Discret | → liste complète | plus de 5 organisations |
| Entrée de navigation | Bouton | → route correspondante | toujours visible ; cadenas si `!canAccess` |
| Badge de compteur | Indicateur | nombre d'éléments en attente | compteur > 0 |
| **Gérer mon offre** | Bouton sur carte | → `/billing` | — |
| Aide & support | Discret | → `/support` | — |
| Avatar + nom | Bloc | → `/settings/profile` | — |
| Icône de déconnexion | Icône | `POST /auth/logout` → `/auth/login` | — |

Le sélecteur affiche par organisation : logo, nom, type, rôle de l'utilisateur, statut
d'abonnement, et un point orange `#F79009` si une action urgente y attend.
Pour un joueur rattaché, le club parent apparaît en dessous avec un chevron vert.

### Barre supérieure

| Élément | Type | Effet |
|---|---|---|
| Fil d'Ariane + titre | Texte | contextuel à la route |
| Recherche globale | Saisie | à la première frappe, ouvre le panneau de résultats groupés |
| Résultat de recherche | Ligne cliquable | → l'élément, ferme le panneau |
| **Nouvelle demande** | Principal | ouvre la modale de demande de visuel |
| Notifications | Icône + badge | déplie le panneau des 5 dernières |
| Tout marquer comme lu | Discret | `PATCH /notifications/read-all` |
| Ouvrir le centre de notifications | Pied de panneau | → `/notifications` |
| Bascule de thème | Icône | clair → sombre, persisté |
| Aide | Icône | → `/support` |
| Avatar | Icône | → `/settings/profile` |

Le panneau de recherche regroupe par catégorie : Contenus, Demandes, Prestations, Équipes et
joueurs, Documents et factures. Chaque groupe affiche son compteur.

---

## 5. Tableau de bord

### Club

| Élément | Type | Effet |
|---|---|---|
| Voir le calendrier | Secondaire | → `/calendar` |
| **Demander une prestation** | Sombre | ouvre le tunnel 5 étapes |
| Gérer l'offre | Sur carte premium | → `/billing` |
| 6 actions rapides | Cartes | Demander un visuel (modale) · Demander une prestation (`/services`) · Importer un document (upload) · Consulter les contenus (`/content`) · Ajouter un événement (`/calendar`) · Inviter un utilisateur (`/users`) |
| Ligne « À traiter » → Valider | Secondaire | → `/content/:id` |
| Ligne « À traiter » → Payer | Secondaire | → `/billing/:id` |
| Ligne « À traiter » → Signer | Secondaire | → `/contracts/:id` |
| Ligne « À traiter » → Compléter | Secondaire | → `/services/:id` |
| Ligne « À traiter » → Relancer | Secondaire | `POST /documents/:id/remind` + toast |
| Tout voir (À traiter) | Discret | → liste filtrée |
| Carte de prestation en cours | Carte cliquable | → `/services/:id` |
| Voir tout (Prestations) | Discret | → `/services` |
| Calendrier (Événements) | Discret | → `/calendar` |
| Vignette de contenu | Carte cliquable | ouvre la fiche média |
| Ouvrir la bibliothèque | Discret | → `/content` |

La carte d'offre affiche 3 jauges dérivées du catalogue d'offres : crédits visuels, présences terrain,
stockage. Chaque ligne « À traiter » porte titre, contexte, priorité, échéance colorée et action.

### Autres profils

Académie, Coach, Joueur et Client ponctuel partagent la même ossature avec un contenu propre :
un bandeau héros contextuel, 3 jauges, une liste prioritaire, une liste secondaire, et les derniers
contenus. Le joueur rattaché affiche en plus le bandeau « CLUB ABONNÉ » avec 4 bénéfices et un
bouton « Voir l'espace du club ».

---

## 6. Demandes de visuels — `/requests`

### Liste

| Élément | Type | Effet |
|---|---|---|
| **Nouvelle demande de visuel** | Principal | ouvre la modale |
| Filtre (Toutes, À valider, En création, Livrées, Brouillons) | Puce | filtre la liste |
| Filtres | Secondaire | déplie les filtres avancés |
| Colonnes | Secondaire | menu de colonnes configurables, 6 cases |
| Exporter | Secondaire | export CSV de la sélection ou de la liste entière |
| Case d'en-tête | Case | sélectionne ou désélectionne toutes les lignes |
| Case de ligne | Case | ajoute la ligne à la sélection |
| Valider la sélection | Principal (barre) | validation en lot, apparaît dès 1 sélection |
| Exporter (barre) | Secondaire | export de la sélection |
| Annuler (barre) | Discret | vide la sélection |
| Action de ligne | Secondaire | Valider · Suivre · Ouvrir · Télécharger selon le statut |
| Pagination | Boutons | page précédente, numéros, page suivante |

L'état vide (filtre Brouillons) affiche l'illustration, le message d'accompagnement et
**Demander un visuel**.

### Modale de demande

| Élément | Type | Effet |
|---|---|---|
| 11 puces de type | Puce radio | Affiche avant-match · Résultat · Composition · Joueur du match · Anniversaire · Recrutement · Stage · Tournoi · Sponsor · Flyer informatif · Autre |
| Équipe, Événement | Liste | pré-remplis depuis l'organisation |
| Date de publication | Date | — |
| Format et plateforme | Liste | Post 1:1 IG · Story 9:16 IG · Reel 9:16 TikTok · Bannière 16:9 |
| Texte à intégrer | Zone de texte | repris tel quel par le studio |
| Zone de dépôt photos et logos | Upload | JPG, PNG, SVG — 20 Mo max |
| 3 options d'urgence | Radio | Standard 5 j (1 crédit) · Prioritaire 48 h (2 crédits) · Express 24 h (3 crédits) |
| **Envoyer la demande** | Principal | décompte les crédits, crée la demande, toast avec le délai |
| Enregistrer en brouillon | Secondaire | sauvegarde sans décompte |
| Fermer | Icône | abandonne |

Le panneau de récapitulatif recalcule en direct : type, urgence, délai estimé, crédits
nécessaires, crédits disponibles, et le solde restant après validation.

---

## 7. Prestations — `/services`

### Kanban et liste

| Élément | Type | Effet |
|---|---|---|
| Kanban / Liste | Puce | bascule de vue |
| **Demander une prestation** | Principal | ouvre le tunnel |
| Carte de prestation | Carte | → `/services/:id` |
| Ligne de liste | Ligne cliquable | → `/services/:id` |

Colonnes du kanban : Demande reçue, À valider, Devis envoyé, Planifiée, Postproduction, Livrée.
Chaque carte porte vignette, titre, date, équipe, montant, progression et avatars des opérateurs.

### Tunnel — 5 étapes

| Étape | Élément | Effet |
|---|---|---|
| 1 | 11 types de prestation | Photo · Vidéo · Photo + vidéo · Drone · Veo · Shooting · Media Day · Tournoi · Stage · Entraînement · Interview |
| 2 | Date, Horaires, Adresse, Équipe, Contact sur place, Besoins spécifiques | l'adresse alimente l'estimation des frais de déplacement |
| 3 | 7 options | Drone +250 € · Reel +180 € · Highlight +220 € · Express 48 h +150 € · Photographe +320 € · Interview +140 € · Stories +110 € |
| 4 | Tarification détaillée | forfait, options, remise liée à l'offre, frais de déplacement, total, acompte 30 % |
| 5 | Récapitulatif + acceptation des conditions | — |
| Toutes | **Continuer** / **Confirmer la demande** | crée la prestation en « demande reçue » |
| Toutes | Retour, Annuler, Fermer | — |

### Fiche prestation — 10 onglets

| Onglet | Contenu | Actions |
|---|---|---|
| Résumé | 8 informations + brief + 6 jalons | — |
| Planning | Déroulé heure par heure avec l'intervenant | — |
| Équipe | 5 intervenants, côté SportVision et côté client | — |
| Brief | 4 sections : Objectif, Contraintes, Références, À éviter | Proposer une modification du brief |
| Fichiers | 5 fichiers avec poids, date, auteur | Ajouter un fichier · Télécharger |
| Livrables | Liste des livrables avec leur statut | — |
| Validation | 5 points de validation | **Confirmer les horaires** |
| Facturation | 6 informations financières | Voir la facture d'acompte · Télécharger le devis signé |
| Historique | 9 entrées horodatées | — |
| Messages | Fil de discussion contextuel | Envoyer |

En-tête de fiche : **Confirmer les horaires** (principal) et Ajouter au calendrier (secondaire).
Retour « Toutes les prestations » en haut à gauche.

---

## 8. Bibliothèque — `/content`

| Élément | Type | Effet |
|---|---|---|
| Créer une collection | Secondaire | modale de création |
| **Tout télécharger** | Sombre | prépare une archive, lien envoyé par e-mail |
| Carte de collection | Carte | ouvre le panneau de collection |
| Filtre de type | Puce | Tous · Photos · Vidéos · Reels · Affiches · Documents |
| Grille / Liste | Puce | bascule de vue |
| Vignette de média | Carte | ouvre la fiche média |
| Ligne de média (vue liste) | Ouvrir | ouvre la fiche média |

Pour un **joueur**, le titre devient « Mes contenus », les collections disparaissent, et un bandeau
explique : « Vous ne voyez que les contenus sur lesquels vous apparaissez. »
Pour un **coach** : « Contenus de mes joueurs », bandeau équivalent.

### Panneau de collection

| Élément | Type | Effet |
|---|---|---|
| Partager par lien | Secondaire | génère un lien sécurisé, **30 jours**, toast de confirmation |
| **Tout télécharger** | Principal | prépare l'archive |
| Vignette | Carte | ouvre la fiche média correspondante |
| Fermer / clic sur le voile | — | ferme le panneau |

### Fiche média

| Élément | Type | Effet |
|---|---|---|
| Lecture | Bouton circulaire | lance la vidéo |
| Barre de progression | Curseur | navigation dans la vidéo ; les commentaires apparaissent en pastilles orange |
| Chapitres | Discret | déplie les chapitres |
| Sélecteur de version | Discret | v1, v2, v3 — finale |
| Champ de commentaire | Saisie | commentaire horodaté à la position courante |
| Publier | Sombre | poste le commentaire |
| **Valider** | Dégradé validation | marque le contenu validé, le rend téléchargeable |
| Demander une correction | Secondaire | renvoie au studio, incrémente le compteur de corrections |
| **Télécharger** | Sombre | fichier haute définition |
| Partager par lien sécurisé | Secondaire | lien à durée limitée |

Deux corrections sont incluses ; la troisième est facturée.

---

## 9. Communication — `/communication`

| Élément | Type | Effet |
|---|---|---|
| Mois / Semaine / Liste | Puce | bascule de vue |
| **Ajouter une publication** | Principal | modale de création |
| Cellule de jour | Zone de dépôt | accepte une publication glissée |
| Publication | Élément déplaçable | glisser-déposer entre dates, vues mois et semaine |
| Carte de la file de publication | Carte | ouvre la fiche publication |
| Ligne de répartition hebdomadaire | Ligne | informatif |

### Fiche publication

| Élément | Type | Effet |
|---|---|---|
| Frise de statut | Indicateur | 8 étapes, les franchies en vert, la courante en violet |
| **Valider la publication** | Dégradé validation | passe en « validé » puis « programmé » |
| Demander une correction | Secondaire | renvoie au studio |
| Champ de commentaire | Saisie + Envoyer | commentaire contextuel |
| Fermer | Icône | ferme le panneau |

Contenu : aperçu du visuel, texte de la publication, hashtags, 6 informations, historique en 4
entrées, commentaires.

---

## 10. Calendrier — `/calendar`

| Élément | Type | Effet |
|---|---|---|
| Mois / Semaine / Jour / Liste | Puce | bascule de vue |
| Exporter | Secondaire | export iCal |
| **Ajouter un événement** | Principal | modale de création |
| Événement | Élément cliquable | ouvre la fiche latérale de l'événement |

Le calendrier fusionne : matchs, entraînements, prestations, tournages, réunions, publications,
échéances de contrat, factures, événements, stages, tournois. Légende de 6 types en haut à droite.

---

## 11. Équipes — `/teams`

| Élément | Type | Effet |
|---|---|---|
| Ajouter une équipe | Sombre | modale de création |
| Carte d'équipe | Carte | → `/teams/:id` |

### Fiche équipe — 6 onglets

| Onglet | Contenu |
|---|---|
| Aperçu | 4 statistiques + 6 informations |
| Effectif | Grille de joueurs avec numéro, poste, nombre de contenus, statut d'autorisation d'image |
| Calendrier | 4 prochains événements de l'équipe |
| Contenus | 4 contenus récents liés |
| Demandes | 3 demandes et prestations liées |
| Documents | 4 documents, dont les autorisations d'image avec leur taux de complétion |

En-tête : Exporter l'effectif (secondaire), **Ajouter un joueur** (principal), retour
« Toutes les équipes ».

### Fiche joueur

| Élément | Type | Effet |
|---|---|---|
| Demander un visuel | Secondaire | ouvre la modale pré-remplie avec ce joueur |
| Relancer | Destructif | **si autorisation manquante** → relance le représentant légal |
| Vignette de contenu | Carte | ouvre la fiche média |

Bandeau d'autorisation d'image : vert si signée, orange si manquante avec la mention
« Les contenus de ce joueur ne sont pas publiables ». Trois restrictions d'usage listées.

---

## 12. Sponsors — `/sponsors`

| Élément | Type | Effet |
|---|---|---|
| **Ajouter un sponsor** | Principal | modale de création |
| Carte de sponsor | Carte | ouvre le panneau de fiche |

4 statistiques en haut : partenaires actifs, montant engagé, livrables réalisés, publications.
Chaque carte porte une jauge de visibilité livrée.

### Fiche sponsor — 4 onglets

| Onglet | Contenu | Actions |
|---|---|---|
| Livrables | 5 livrables avec avancement | — |
| Contrat | 6 informations + 5 engagements du club | Télécharger le contrat signé |
| Publications | 4 publications liées avec statut | — |
| Documents | 4 documents | — |

En-tête : Exporter le bilan (secondaire). Bandeau premium avec le pourcentage de visibilité livrée.

---

## 13. Contrats — `/contracts`

| Élément | Type | Effet |
|---|---|---|
| **Signer l'avenant** | Sur bandeau premium | → signature Yousign |
| Ouvrir | Secondaire | ouvre le panneau de fiche |

Le bandeau met en évidence : durée d'engagement, préavis, mensualité, date de renouvellement, fin
d'engagement.

### Fiche contrat

| Élément | Type | Effet |
|---|---|---|
| Télécharger le PDF | Secondaire | document signé |
| **Signer avec Yousign** | Principal | ouvre Yousign |
| **Ouvrir Yousign** | Sur bandeau | idem, depuis l'encart de signature en attente |
| Voir les annexes | Secondaire | liste des annexes |

Contenu : 8 conditions principales, 5 points « À retenir », échéancier en 5 lignes, aperçu du PDF.
Le lien de signature expire au bout de **8 jours**.

---

## 14. Factures — `/billing`

| Élément | Type | Effet |
|---|---|---|
| **Payer maintenant** | Destructif | **si facture en retard** → règlement Stripe |
| Voir l'échéancier | Secondaire | déplie les mensualités à venir |
| Gérer le moyen de paiement | Secondaire | portail Stripe |
| Ouvrir | Secondaire | ouvre le panneau de fiche |

Trois cartes en haut : facture en retard (rouge), prochaine mensualité, moyen de paiement.
Le moyen de paiement n'affiche que les 4 derniers chiffres et l'expiration.

### Fiche facture

| Élément | Type | Effet | Condition |
|---|---|---|---|
| Télécharger le PDF | Secondaire | facture PDF | toujours |
| **Payer \<montant\>** | Principal | règlement Stripe, toast de confirmation | statut à payer ou en retard |
| **Télécharger le reçu** | Sombre | reçu PDF | statut payée |
| Fermer | Icône | ferme le panneau | toujours |

Contenu : 6 informations émetteur/client, dates, lignes détaillées avec quantité et prix unitaire,
totaux HT/TVA/acompte, net à payer. Le libellé du total s'adapte : « Net à payer », « Montant
réglé » ou « Montant estimé » selon le statut. Bandeau contextuel selon l'état.

---

## 15. Utilisateurs — `/users`

| Élément | Type | Effet |
|---|---|---|
| **Inviter un utilisateur** | Principal | modale : e-mail, rôle, périmètre d'équipes |
| Menu de ligne (···) | Icône | Modifier le rôle · Changer le périmètre · Renvoyer l'invitation · Désactiver · Réactiver |

Colonnes : utilisateur (avatar, nom, e-mail), rôle, équipes, dernière connexion, statut.

---

## 16. Documents — `/documents`

| Élément | Type | Effet |
|---|---|---|
| **Importer un document** | Principal | upload |
| Ouvrir | Secondaire | aperçu du document |

---

## 17. Notifications — `/notifications`

| Élément | Type | Effet |
|---|---|---|
| Préférences | Secondaire | ouvre la modale de préférences |
| **Tout marquer comme lu** | Sombre | `PATCH /notifications/read-all` |
| Filtre de catégorie | Puce | Toutes · Contenus · Prestations · Contrats · Paiements · Utilisateurs · Système |
| Ouvrir | Secondaire | → l'élément concerné |

Regroupement par jour : Aujourd'hui, Hier, Cette semaine. Les notifications non lues ont un fond
`#F7F9FF` et un point bleu. Les notifications importantes portent un badge « IMPORTANT ».

### Modale de préférences

| Élément | Type | Effet |
|---|---|---|
| Bascule e-mail | Interrupteur | par catégorie |
| Bascule application | Interrupteur | par catégorie |
| Fréquence | Liste | Immédiat · Résumé quotidien · Résumé hebdomadaire · Jamais |
| **Enregistrer** | Principal | `PATCH /notifications/preferences` + toast |
| Annuler | Discret | ferme sans enregistrer |

8 catégories. Trois réglages d'heures calmes : pas avant 08h00, pas après 21h00, dimanche en
urgences uniquement. Mention explicite : les notifications critiques — impayé, suspension, contrat
expiré — sont toujours envoyées.

---

## 18. Support — `/support`

| Élément | Type | Effet |
|---|---|---|
| Recherche | Saisie | recherche dans les articles |
| Carte de sujet | Carte | ouvre l'article |
| Revoir le tutoriel de bienvenue | Carte | rouvre l'onboarding à l'étape 1 |
| **Nouveau ticket** | Sombre | modale : catégorie, priorité, description, fichier, module concerné |
| **Le contacter** | Principal | ouvre un fil avec le chargé de compte |

Encart d'interlocuteur avec avatar, nom, fonction, et indicateur d'état des services.

### Fil de messages — client ponctuel uniquement

| Élément | Type | Effet |
|---|---|---|
| Zone de saisie | Texte | message |
| Joindre un fichier | Secondaire | upload |
| **Envoyer** | Principal | poste le message |
| Ouvrir ma prestation | Secondaire | → `/services/:id` |

Panneau latéral : 4 informations du dossier, et « En attente de vous » avec les actions attendues
du client.

---

## 19. Paramètres — `/settings`

### Personnel

| Élément | Type | Effet |
|---|---|---|
| Changer la photo | Secondaire | upload |
| Nom, Téléphone, E-mail, Langue | Saisie | — |
| **Activer** la double authentification | Sombre | lance l'enrôlement MFA |
| Apparence sombre | Interrupteur | bascule le thème, persisté |
| **Enregistrer** | Principal | `PATCH /users/me` |
| Annuler | Secondaire | rétablit les valeurs |

### Organisation

| Élément | Type | Effet |
|---|---|---|
| Changer le logo | Secondaire | upload |
| Nom, Adresse, Instagram, SIRET | Saisie | — |
| Couleurs du club | Nuancier | 3 couleurs + bouton d'ajout |

### Intégrations

| Élément | Type | Effet |
|---|---|---|
| **Connecter** / **Reconnecter** | Secondaire | ouvre le panneau de synchronisation |

6 intégrations : Google Calendar, Instagram, TikTok, Meta Business, WhatsApp, Stripe.
Chacune affiche : état, compte lié, dernière synchronisation.

### Panneau de synchronisation

| Élément | Type | Effet |
|---|---|---|
| **Synchroniser maintenant** | Principal | déclenche la synchronisation + toast |
| Déconnecter | Destructif | révoque l'accès, les données restent dans Connect |
| Annuler / Fermer | Discret | ferme le panneau |

Contenu : bandeau d'état, 4 autorisations demandées (dont une explicitement **non** demandée :
supprimer des événements), table de correspondance des calendriers avec le sens de synchronisation,
historique en 3 entrées.

---

## 20. Module verrouillé

Écran affiché sur toute route dont `canAccess` retourne faux.

| Élément | Type | Effet |
|---|---|---|
| Parler à mon conseiller | Secondaire | → `/support` |
| **Découvrir les offres** | Principal | → `/billing` |

Message : « Ce module n'est pas activé sur votre contrat actuel (\<offre\>). Votre interlocuteur
SportVision peut l'ajouter à tout moment. »

---

## 21. E-mails transactionnels

Huit e-mails, un gabarit unique, une seule action principale par message.

| Déclencheur | Objet | Action principale | Action secondaire |
|---|---|---|---|
| Contenu livré, en attente de validation | Votre affiche Matchday est prête à être validée | Valider le contenu | Demander une correction |
| Facture échue depuis 3 jours | Facture SV-2026-0418 — échue depuis 3 jours | Payer la facture | Voir la facture |
| Contrat envoyé pour signature | Votre contrat \<offre\> attend votre signature | Signer avec Yousign | Lire le contrat |
| Prestation planifiée et confirmée | \<Prestation\> confirmé — \<date\> | Voir la prestation | Ajouter à mon calendrier |
| Contenus livrés dans la médiathèque | \<N\> photos disponibles — \<événement\> | Ouvrir la galerie | Tout télécharger |
| Invitation d'un utilisateur | \<Nom\> vous invite à rejoindre \<organisation\> | Créer mon mot de passe | — |
| Correction demandée par un membre | Correction demandée sur \<contenu\> | Voir la demande | — |
| Crédits mensuels presque épuisés | Il vous reste \<N\> crédits visuels ce mois-ci | Gérer mon offre | Contacter mon conseiller |

Chaque e-mail porte en pied : rappel de l'organisation concernée, lien vers les préférences de
notification, lien vers le centre d'aide, lien vers Connect, et la mention de non-réponse.

Le bloc signature affiche l'interlocuteur SportVision assigné avec son numéro.
