# SPORTVISION CONNECT — MASTER PROMPT COMPLET V1

Architecture fonctionnelle, rôles, interfaces, inscriptions, parcours, permissions, workflows et contrôle qualité.

**Document maître de référence produit, version complète (12/08/2026, remplace la version précédente du 11/08).** Fourni par Fouka en PDF. À donner en contexte avant de faire auditer ou modifier une page précise de Connect. Objectif : éviter qu'un agent recrée des fonctions qui contredisent le reste de l'application.

Version de référence — Août 2026.

## 0. Instruction maître à l'agent

Tu prends en charge SportVision Connect V1 comme un développeur senior, Product Owner et QA. Ta mission n'est pas seulement de lire ce document : tu dois inspecter l'existant, comprendre les choix techniques déjà présents, conserver ce qui fonctionne, corriger les incohérences, compléter les interfaces et parcours manquants, sécuriser les permissions et tester chaque flux de bout en bout.

Ne reconstruis pas Connect depuis zéro. Le projet existe déjà. Tu dois partir de la base de code, du schéma de données et des composants existants. Quand la fonctionnalité actuelle est cohérente avec ce cahier, conserve-la. Quand elle est partiellement correcte, améliore-la. Quand elle est dangereuse ou contradictoire, corrige-la.

**Autonomie attendue** : pendant la session, ne demande pas d'autorisation pour corriger les bugs évidents, les problèmes responsive, les permissions incorrectes, les états vides, les erreurs de navigation, les textes incohérents ou les formulaires cassés. Ne demande une décision que lorsqu'elle change réellement le modèle commercial ou exige une information impossible à déduire.

- Analyser l'architecture actuelle avant les modifications lourdes.
- Créer un inventaire des routes, rôles, modules, tables, API et intégrations utilisées par Connect.
- Faire un état des écarts entre l'existant et ce document.
- Corriger d'abord les écarts qui cassent un parcours utilisateur ou créent un risque de sécurité.
- Tester sur desktop, tablette et mobile.
- Vérifier que chaque action Connect remonte correctement dans SportVision OS lorsque cela est prévu.
- Ne laisser aucun bouton décoratif qui simule une action non fonctionnelle.
- Ne pas afficher de données mockées comme si elles étaient réelles.
- Ne pas développer les fonctionnalités V2 explicitement exclues (§57).

## 1. Vision produit et frontière de Connect

SportVision Connect est le portail externe officiel de SportVision. Il centralise la relation entre SportVision et ses clients, leurs responsables autorisés et, dans certains cas, les membres ou joueurs auxquels un accès a été accordé.

Connect ne doit pas devenir un logiciel généraliste de gestion sportive. Il ne remplace pas un logiciel de licences, de convocations, d'absences, de statistiques sportives, de feuilles de match ou de cotisations. Son périmètre est la relation média, communication, prestation, contenu, document, paiement et échange avec SportVision.

**Principe produit** : Un président vient piloter la relation du club avec SportVision. Un responsable communication vient gérer ses demandes et récupérer ses contenus. Un éducateur vient suivre ce qui concerne son équipe. Un joueur vient retrouver ses contenus et les informations SportVision qui le concernent. Un client individuel vient suivre sa prestation personnelle.

### 1.1 Connect et SportVision OS

Connect est l'interface externe. SportVision OS est l'interface interne de l'équipe SportVision. Ils ne doivent pas créer deux versions indépendantes de la même prestation ou de la même demande.

- Connect : le client consulte, demande, répond, télécharge, signe ou paie selon ses droits.
- OS : SportVision reçoit, traite, planifie, attribue, produit, facture et pilote.
- Une demande créée dans Connect doit apparaître dans OS.
- Une prestation validée ou modifiée dans OS doit être reflétée dans Connect.
- Un contenu livré depuis le processus interne doit devenir visible dans Connect.
- Un contrat ou une facture créé côté SportVision doit devenir visible uniquement aux utilisateurs Connect autorisés.

### 1.2 Objets métier partagés

Avant de créer une nouvelle table ou un nouvel objet métier, vérifier si la donnée existe déjà dans l'OS ou dans la base commune. Éviter les doublons tels que `connect_service` et `os_service` pour une seule et même prestation. Préférer un objet unique avec des vues, permissions et états adaptés aux deux applications.

## 2. Types de clients et d'organisations

| Type | Utilisation | Profils habituels |
|---|---|---|
| Club | Club amateur ou structure sportive avec plusieurs utilisateurs. | Admin, communication, éducateur, joueur. |
| Académie | Académie ou structure de formation sportive. | Admin, communication, éducateur selon besoin. |
| Stage / Camp | Organisation temporaire liée à un stage. | Admin ou responsable projet. Module Famille exclu de la V1. |
| Organisateur de tournoi | Structure organisant des tournois ou événements. | Admin / responsable événement. |
| Préparateur physique | Professionnel accompagné par SportVision. | Admin simple ou espace projet. |
| Entreprise / marque | Client communication, création de contenu ou média. | Admin / communication. |
| Client individuel | Joueur ou particulier achetant une prestation pour lui-même. | Compte individuel. |
| Espace Projet | Mission ponctuelle B2B sans besoin de structure complète. | Compte projet simplifié. |

## 3. Architecture des comptes

Trois niveaux distincts : utilisateur, organisation, appartenance.

- `user` : identité, email, authentification, profil personnel.
- `organization` : club, académie, entreprise ou autre structure.
- `membership` : lien entre user et organization, rôle, statut et permissions.
- `offer/plan` : offre SportVision active pour l'organisation ou le client.
- `module entitlements` : fonctionnalités réellement disponibles selon l'offre.

**RÈGLE DE SÉCURITÉ** : Le rôle technique n'est jamais déterminé par une simple valeur envoyée par le navigateur. L'utilisateur peut déclarer sa fonction réelle dans un formulaire, mais ce champ n'accorde aucune permission. Les permissions sont attribuées côté serveur par SportVision ou par une invitation autorisée.

## 4. Processus public : demande d'inscription d'un club

La V1 doit permettre à une structure qui n'utilise pas encore Connect de faire une demande d'ouverture. Ce parcours est public mais il ne crée pas immédiatement une organisation active ni un administrateur. Il crée une demande à vérifier par SportVision.

### 4.1 Point d'entrée

- Depuis la vitrine : bouton « Rejoindre SportVision Connect », « Demander un accès » ou équivalent.
- Depuis la page de connexion : lien secondaire « Votre structure n'utilise pas encore Connect ? Faire une demande ».
- La page doit clairement distinguer « Mon club utilise déjà Connect » et « Je souhaite inscrire ma structure ».

### 4.2 Étape 1 - Votre structure

- Nom de la structure - obligatoire.
- Type : Club, Académie, Stage/Camp, Tournoi, Préparateur physique, Entreprise/Marque, Autre.
- Ville - obligatoire.
- Code postal - recommandé.
- Pays - France par défaut si cohérent avec l'implantation actuelle.
- Site internet - facultatif.
- Instagram / réseau principal - facultatif.

### 4.3 Étape 2 - Votre identité et votre fonction

- Prénom - obligatoire. Nom - obligatoire. Email professionnel/contact - obligatoire. Téléphone - obligatoire.
- Fonction dans la structure - obligatoire, via liste déroulante : Président(e), Vice-président(e), Directeur / Directrice, Secrétaire, Trésorier / Trésorière, Responsable communication, Community Manager, Responsable sportif / Directeur sportif, Responsable administratif, Responsable partenariat / sponsoring, Éducateur / Éducatrice, Entraîneur / Entraîneuse, Responsable d'équipe, Photographe / Vidéaste du club, Joueur / Joueuse, Bénévole, Membre du bureau, Autre.
- Si « Autre » : champ texte « Précisez votre fonction » obligatoire.

**IMPORTANT** : Choisir « Président(e) » dans cette liste ne crée jamais `organization_admin`. Le système enregistre par exemple `declared_function="Président"`. Le rôle Connect réel est attribué plus tard après validation.

### 4.4 Étape 3 - Besoins SportVision

Choix multiples, servent à qualifier la demande commerciale, n'activent rien automatiquement : Prestations photo/vidéo, Communication du club, Création de visuels, Full Communication, Club+, Couverture de matchs, Tournoi/stage, Veo/captation, Création de contenu, Je souhaite découvrir SportVision, Autre (champ de précision).

### 4.5 Étape 4 - Récapitulatif et validation

Récap modifiable sans perte de données. Case obligatoire : « Je certifie être autorisé(e) à effectuer cette demande au nom de cette structure. » Consentements/liens juridiques. CTA « Envoyer ma demande ».

### 4.6 Après envoi

1. Créer une demande d'ouverture Connect en base, pas une organisation active.
2. Confirmation claire au demandeur.
3. Confirmation par e-mail.
4. Entrée dans SportVision OS (file de demandes).
5. Notifier l'équipe SportVision.
6. Conserver fonction déclarée + besoins.

Message recommandé : « Votre demande a bien été transmise à SportVision. Notre équipe va vérifier les informations de votre structure avant l'activation de votre espace Connect. »

## 5. Validation d'une nouvelle structure par SportVision

Fiche exploitable dans l'OS : infos club, contact, fonction déclarée, besoins, date. Actions : « Valider et créer la structure », « Demander des informations », « Refuser / archiver » (motif interne). SportVision confirme type d'organisation, offre, date d'activation, premier utilisateur autorisé — et choisit explicitement le rôle Connect du premier utilisateur (par défaut Administrateur proposé pour le contact principal, mais décision serveur contrôlée, jamais automatique).

### 5.1 Création de l'organisation

1. Créer/activer l'organisation client dans la base commune.
2. Associer l'identifiant client OS existant si applicable.
3. Configurer l'offre active et les modules autorisés.
4. Créer une invitation pour le contact principal.
5. Ne pas créer de mot de passe au nom du client.
6. Envoyer un lien d'activation sécurisé.

## 6. Processus d'invitation et d'activation

### 6.1 Invitation

Token aléatoire non prédictible, date d'expiration, organisation, email invité, rôle prévu, émetteur. Rôle fixé côté serveur, non modifiable par le formulaire d'activation.

### 6.2 Email d'invitation

Nom de la structure, nom SportVision Connect, rôle/type d'accès si utile, CTA « Activer mon compte », durée de validité, lien d'aide.

### 6.3 Écran d'activation

Organisation qui invite, email préréempli non modifiable, prénom/nom si inconnus, mot de passe + confirmation, acceptations, CTA « Créer mon compte ».

### 6.4 Invitation expirée

« Cette invitation n'est plus valide. » + action pour redemander un lien / contacter l'admin. Ne jamais créer de membership incomplet à partir d'un token expiré.

## 7. Processus : inviter un membre dans une organisation existante

Un administrateur autorisé invite depuis Connect. Rôle choisi par l'administrateur à l'invitation. L'invité ne choisit pas son rôle à l'activation.

### 7.1 Formulaire d'invitation

Prénom, nom, email, rôle Connect, équipe/catégorie facultative, fonction réelle facultative si différente du rôle technique.

### 7.2 Rôles proposés pour un club

Administrateur, Responsable communication, Éducateur / responsable sportif, Joueur, autre rôle interne uniquement si les permissions correspondantes sont réellement implémentées.

**NE PAS CONFONDRE** : la liste publique « fonction dans le club » est descriptive et large. La liste d'invitation « rôle Connect » doit rester courte et contrôlée, car elle détermine les permissions.

## 8. Connexion, session et récupération de compte

### 8.1 Page de connexion

Logo, champ email, champ mot de passe, afficher/masquer, CTA « Se connecter », « Mot de passe oublié ? », « Besoin d'aide ? », lien secondaire structures non inscrites.

Ne jamais demander à l'utilisateur de sélectionner « joueur », « président » ou « admin » à la connexion. Le serveur connaît son membership et charge l'interface correspondante.

### 8.2 Mot de passe oublié

Email → message générique (compte existe ou non) → lien temporaire → nouveau mot de passe → invalider le token → retour connexion avec confirmation.

### 8.3 Session

Session sécurisée entre rafraîchissements. Expiration → redirection connexion + message clair. Déconnexion → invalidation locale et serveur. Changement de mot de passe sensible → politique de renouvellement de session appropriée.

## 9. Première connexion et onboarding

Court, dashboard atteignable en moins d'une minute. Écran Bienvenue (organisation + rôle) → compléter éventuellement téléphone/photo (jamais obligatoire si pas nécessaire) → 2-3 cartes max des fonctions principales → CTA « Accéder à mon espace ».

Messages par rôle : Admin « Demandez une prestation, suivez vos contenus et retrouvez vos documents. » Communication « Envoyez vos demandes, suivez leur production et récupérez vos contenus. » Éducateur « Retrouvez les prestations et contenus liés à votre équipe. » Joueur « Retrouvez vos contenus et les prochains événements SportVision liés à votre club. » Client individuel « Suivez votre prestation, vos documents et vos contenus. »

## 10. Structure visuelle commune

**Desktop** : sidebar gauche, topbar (recherche/notifications/aide/profil), zone centrale largeur confortable, un seul système de composants.

**Mobile** : sidebar → drawer/menu, CTA au pouce, tableaux → cartes/listes, galeries optimisées scroll/swipe, aucun débordement à 375px.

**Sidebar dynamique** : ne jamais afficher systématiquement tous les modules avec des cadenas. Module non pertinent/interdit → absent. Upsell affiché seulement s'il a une vraie utilité commerciale pour le rôle.

## 11. Rôles Connect et matrice de permissions

| Fonction | Admin | Communication | Éducateur | Joueur | Individuel |
|---|---|---|---|---|---|
| Accueil | Oui | Oui | Oui | Oui | Oui |
| Prestations organisation | Oui | Selon droits | Lecture ciblée | Non | Non |
| Prestations personnelles | Selon cas | Non | Non | Option | Oui |
| Demandes de visuels | Oui | Oui | Non | Non | Non |
| Contenus | Oui | Oui | Oui | Oui | Oui |
| Calendrier | Oui | Oui | Oui | Lecture | Selon besoin |
| Rendez-vous | Oui | Selon offre | Selon besoin | Selon besoin | Oui |
| Documents du club | Oui | Selon permission | Non | Non | Non |
| Factures du club | Oui | Permission spéciale | Non | Non | Non |
| Utilisateurs | Oui | Non | Non | Non | Non |
| Messages | Oui | Oui | Oui | Oui | Oui |
| Paramètres organisation | Oui | Non | Non | Non | Non |
| Offre / crédits | Oui | Selon besoin | Non | Non | Selon offre |

Comportement par défaut. Des permissions fines peuvent compléter mais ne doivent jamais élargir silencieusement les accès financiers ou administratifs.

## 12. Interface administrateur d'organisation

Référent principal (président/dirigeant/responsable mandaté pour un club). Interface la plus complète.

**Navigation** : Accueil, Prestations, Demandes, Contenus, Calendrier, Rendez-vous si actif, Documents, Factures, Utilisateurs, Messages, Paramètres, Aide & support.

**Dashboard** : orienté action — « qu'est-ce que je dois faire ? » puis « qu'est-ce qui arrive ? » puis « qu'est-ce qui vient d'être livré ? ». Blocs : À traiter (contrats à signer, factures, infos manquantes, réponses attendues) ; Prochainement ; Derniers contenus ; Demandes ; Offre (si pertinent). État vide : « Rien à traiter pour le moment. Tout est à jour. » Jamais de KPI fictifs.

## 13. Interface responsable communication

Concentré communication + récupération contenus. Ne voit pas les finances par défaut.

**Navigation** : Accueil, Demandes de visuels/communication, Contenus, Calendrier, Prestations utiles selon droits, Messages, Mon profil, Aide.

**Dashboard** : demandes en cours, crédits disponibles si l'offre en utilise, derniers contenus livrés, prochain événement SportVision, messages/actions en attente.

**PERMISSION FINANCIÈRE** : ne doit pas automatiquement voir factures, devis financiers ou contrats globaux. Accès documentaire spécifique possible si besoin réel, mais explicite.

## 14. Interface éducateur / responsable sportif

Rôle opérationnel. Voit ce qui concerne son équipe/événements autorisés, pas la gestion administrative générale.

**Navigation** : Accueil, Prestations/événements liés à son périmètre, Contenus, Calendrier, Messages, Mon profil, Aide.

**Dashboard** : prochaine présence SportVision, événements à venir, derniers contenus, messages importants.

Ne pas afficher : Factures, Utilisateurs, Gestion de l'offre, Paramètres organisation, Intégrations.

## 15. Interface joueur

Expérience à part entière — jamais un compte admin auquel on aurait ajouté des cadenas.

**Navigation V1** : Accueil, Mes contenus, Calendrier, Mon club, Messages, Mon profil, Aide.

**Dashboard** : titre « Bonjour [Prénom] », sous-titre « Retrouvez vos contenus et les prochains événements liés à votre club. » Prochain événement, Nouveaux contenus, Mon club (logo/nom/équipe/catégorie/rôle), Messages récents, Favoris si implémenté.

**Ce que le joueur ne voit jamais** : Factures du club, Devis du club, Contrats du club, Liste d'utilisateurs, Crédits organisation, Gestion de l'offre, Paramètres organisation, Intégrations, données financières/admin d'un autre membre, prestations B2B réservées aux dirigeants sauf module personnel explicitement activé.

## 16. Interface client individuel / Espace Projet

Pas toute l'interface Club. Accueil, Mes prestations/Mon projet, Mes contenus, Mes rendez-vous si nécessaire, Mes documents, Mes factures personnelles si applicable, Messages, Mon profil.

Dashboard : prochaine prestation, document à signer, paiement éventuel, contenu disponible, message SportVision.

## 17. Module Prestations

**Liste** : filtres Toutes/À venir/En cours-production/Livrées/Terminées/Annulées. Carte : type, date, lieu, statut, action « Voir ». Contenu livré/documents liés si pertinent. Uniquement les prestations de son organisation/périmètre.

**Fiche** : informations (type/date/heure/lieu/statut), détails métier (adversaire/catégorie/participants/brief), équipe SportVision si valeur, production (état/livrables), documents liés selon droits, paiement selon autorisation, historique.

**Statuts normalisés** : Demandée, En validation, Confirmée, Planifiée, En cours, En production, Livrée, Terminée, Annulée.

## 18. Wizard « Demander une prestation »

Doit créer une vraie demande backend, visible dans OS, jamais une simulation frontend.

**Étape 1 - Prestation** : Match Photo, Match Vidéo, Pack Match Complet, Shooting, Couverture Tournoi, Couverture Stage, Création de contenu, Veo/captation, Drone, autres services réellement commercialisés. Catalogue centralisé, jamais de tarifs dupliqués dans plusieurs composants. Filtrage possible selon type de client/offre.

**Étape 2 - Informations** dynamiques selon le service (match/shooting/tournoi/stage/création de contenu ont des champs différents).

**Étape 3 - Options** : seulement celles compatibles et réellement disponibles ; si validation commerciale nécessaire, l'indiquer plutôt qu'inventer un tarif.

**Étape 4 - Tarification** : pro → HT/TTC selon logique réelle ; particulier → TTC prioritaire ; prix fixe → source catalogue ; tarif variable → « Sur devis ». Jamais de prix à décimales artificielles non validées. Prendre en compte options/frais sans dupliquer les formules.

**Étape 5 - Récapitulatif** : type, date/heure, lieu, options, prix ou « sur devis », infos complémentaires, CTA « Envoyer ma demande ».

**Après envoi** : créer la demande (organization_id + créateur), enregistrer les données, notification interne OS, afficher dans la liste Connect, confirmation client, traitement possible depuis OS.

## 19. Module Demandes de visuels

Réservé aux offres qui l'incluent (Club+/Full Communication selon config). Pas affiché au joueur.

**Liste** : filtres Toutes/À traiter-En cours/En validation/Livrées/Annulées. CTA « Nouvelle demande de visuel ».

**Nouveau visuel** : type (avant-match/composition/résultat/joueur du match/événement/annonce/autre), titre, brief/texte, date souhaitée, fichiers/logos, instructions, coût en crédits si applicable.

**Statuts** : Nouvelle, À traiter, En production, En validation, Livrée, Annulée.

## 20. Crédits Club+

Source unique, visibles uniquement aux utilisateurs utiles, cohérents entre Connect et OS. Solde + période de renouvellement si pertinent. Coût indiqué avant validation d'une demande. Décrément via logique serveur transactionnelle, pas frontend. Éviter solde négatif sauf règle métier explicite. Historiser les mouvements importants. Le joueur ne voit pas les crédits organisation.

## 21. Module Contenus

**Vocabulaire** : « Mes contenus » plutôt que « Mes livrables » pour joueurs/non-techniques. Documents administratifs restent dans Documents.

**Organisation** : filtres Tous/Photos/Vidéos/Reels/Affiches selon accès. Regroupement par événement/prestation (ex. « FC Montereau vs Sens - 42 photos, 3 vidéos, 1 reel »). Date de livraison/statut si utile. CTA « Voir les contenus ».

**Galerie/détail** : aperçus optimisés web, téléchargement individuel, « Tout télécharger » si le backend le supporte, favoris personnels si implémentés, lazy loading/pagination pour gros volumes, URLs privées/signées.

**Contenus joueur** : uniquement les contenus autorisés par son club/droits. Jamais d'accès élargi en modifiant un identifiant d'URL — toute autorisation vérifiée côté serveur.

## 22. Module Calendrier

**Vues** : Mois, Semaine, Jour, Liste.

**Événements** : prestations SportVision, tournages, shootings, rendez-vous, échéances pertinentes, événements autorisés liés au club/utilisateur.

**Permissions** : Admin gestion selon fonctions disponibles ; Communication édition limitée ; Éducateur lecture/actions dans son périmètre ; Joueur lecture principalement, ne modifie jamais le calendrier officiel du club.

**Google Calendar** : si l'app ne fait qu'ouvrir un lien de création d'événement, nommer l'action « Ajouter à Google Calendar »/« Ajouter à mon calendrier ». Ne jamais promettre une « synchronisation automatique » sans vraie intégration bidirectionnelle.

## 23. Module Rendez-vous

N'afficher que si le parcours est réellement fonctionnel et utile au rôle. Prochains/passés, date/heure, interlocuteur SportVision, lieu/lien visio, CTA « Prendre un rendez-vous » uniquement si réel. Si le joueur n'a pas besoin de rendez-vous en V1, retirer l'entrée de menu plutôt que laisser un cadenas.

## 24. Module Documents

**Catégories** : Devis, Contrats, Factures/documents administratifs selon structure existante.

**RÈGLE CRITIQUE** : Un joueur ne voit jamais les devis, contrats et factures de son club. Un responsable communication ne reçoit pas automatiquement l'accès aux finances. Le backend doit contrôler `organization_id` + `membership` + `permission` à chaque requête.

**Devis** : référence, objet, date, montant, statut (disponible/accepté/refusé/expiré), télécharger/accepter selon workflow réel.

**Contrats** : nom, période, statut (brouillon/envoyé/à signer/signé/expiré/annulé), CTA signature via processus sécurisé uniquement, le client ne peut jamais modifier directement le statut de signature.

**Factures** : numéro, date, échéance, montant, statut (à venir/en attente/payée/en retard/annulée), téléchargement, paiement si Stripe réellement activé.

## 25. Paiements Stripe

Stripe = source de vérité externe, le webhook serveur confirme l'état avant de débloquer un statut « payé ».

1. Créer l'objet paiement/checkout côté serveur.
2. Rediriger/afficher le composant Stripe sécurisé.
3. Ne pas considérer le simple retour navigateur comme confirmation.
4. Recevoir le webhook Stripe.
5. Vérifier signature + idempotence.
6. Mettre à jour la facture/commande côté serveur.
7. Répercuter l'état dans OS et Connect.
8. Notifier le client si nécessaire.

**TEST OBLIGATOIRE AVANT PRODUCTION** : succès, échec, abandon, webhook reçu, webhook dupliqué, remboursement selon les fonctions réellement utilisées. Un paiement réel ne doit pas rester indéfiniment « en attente ».

## 26. Signature électronique / Yousign

Réutiliser l'intégration existante si fonctionnelle. Ne jamais exposer de clé API au frontend. OS crée/prépare le document → client voit « À signer » dans Connect → processus de signature externe initié via le backend → statut signé revient via API/webhook sécurisé → OS et Connect affichent le même état. En cas d'erreur, message humain au client + trace exploitable pour l'équipe.

## 27. Module Utilisateurs

Réservé aux administrateurs d'organisation et rôles explicitement autorisés. Liste (nom/email/rôle/statut), inviter, renvoyer invitation, modifier rôle selon permissions, désactiver un accès, ne pas supprimer brutalement l'historique métier.

**Désactivation** : préférer `membership=inactive`. Plus d'accès aux nouvelles données privées. Politique d'accès aux anciens contenus cohérente et explicitement définie.

## 28. Module Messages

Simplifie la relation avec SportVision — pas un réseau social ni un clone de Slack. Liste des conversations desktop / plein écran mobile. Interlocuteur « Équipe SportVision » ou responsable désigné. Champ message, pièces jointes si upload sécurisé et utile, date/heure, état lu/non lu si réellement supporté. Ne jamais afficher « En ligne » sans véritable présence temps réel.

## 29. Notifications

| Type | Exemple de message |
|---|---|
| Demande | Votre demande a été reçue / mise à jour. |
| Prestation | Votre prestation a été confirmée ou modifiée. |
| Contenu | De nouveaux contenus sont disponibles. |
| Contrat | Un document attend votre signature. |
| Facture | Une facture est disponible ou arrive à échéance. |
| Message | Vous avez reçu un message. |
| Rendez-vous | Rappel d'un rendez-vous proche. |
| Invitation | Invitation à rejoindre une organisation. |

Compteur non lu, tout marquer comme lu, marquer lu à l'ouverture selon comportement choisi, pas de doublons provoqués par des webhooks répétés. Chaque notification doit rediriger vers la bonne ressource.

## 30. Recherche globale

Interroge uniquement les données autorisées (contenus/prestations/demandes/documents selon rôle).

**SÉCURITÉ** : une recherche « facture » depuis un compte joueur ne doit JAMAIS faire apparaître une facture du club, même si la base contient ce document. La sécurité ne repose pas sur le masquage de l'interface.

## 31. Paramètres et profil

**Administrateur** : Personnel, Organisation, Intégrations (si réellement actives), Notifications, Sécurité/mot de passe.

**Communication/Éducateur** : Personnel, Notifications, Mot de passe/sécurité. Pas d'onglet organisation complet par défaut.

**Joueur** : Photo, Prénom, Nom, Téléphone si utile, Email, Mot de passe, Notifications, Mon club en lecture seule si souhaité.

Masquer les fonctionnalités « Bientôt disponible » (ex. double authentification non prête). Une fonction existe et fonctionne, ou elle n'est pas présentée dans la V1.

## 32. Offres, modules et affichage conditionnel

L'offre active détermine les modules disponibles, mais le rôle détermine ce que l'utilisateur voit réellement. Un joueur d'un club Full Communication ne doit pas voir la gestion de l'offre Full Communication.

| Offre / contexte | Modules possibles |
|---|---|
| Prestation ponctuelle | Prestations, contenus, documents autorisés, messages. |
| Club+ | Ajoute demandes de visuels, crédits, avantages configurés. |
| Full Communication | Ajoute modules communication, planning, suivi prévus. |
| Client individuel | Prestations personnelles, contenus, documents personnels, messages. |
| Espace Projet | Projet, contenus, documents, échanges adaptés à la mission. |

Club+ est une offre dans SportVision Connect, pas une application séparée. Ne pas recréer un ancien « Portail SportVision » ou une application Club+ distincte.

## 33. Carte d'offre dans la sidebar

Visible aux administrateurs si utile : nom de l'offre, statut actif, crédits/présences pertinents, CTA de gestion si une vraie page existe.

Pour un joueur : remplacer par une information légère sur le club, ou ne rien afficher. Ne jamais afficher « 1 crédit / mois », « Gérer mon offre » ou des informations contractuelles organisation au joueur.

## 34. Aide & support

FAQ courte, contacter SportVision, accès aux messages, email de support approprié, résolution de problèmes fréquents. Pas de système de tickets lourd en V1 s'il n'existe pas déjà.

## 35. Empty states, loading et erreurs

| Page | État vide attendu |
|---|---|
| Contenus | Aucun contenu pour le moment. Vos prochains contenus apparaîtront ici après leur livraison. |
| Prestations | Vous n'avez aucune prestation en cours. CTA de demande uniquement pour les rôles autorisés. |
| Documents | Aucun document disponible pour le moment. |
| Messages | Aucun message pour le moment. Vous pourrez échanger avec SportVision depuis cet espace. |
| Calendrier | Aucun événement SportVision prévu sur cette période. |

**Loading** : skeletons/indicateurs cohérents, CTA désactivés pendant l'envoi, éviter double demande/upload/paiement.

**Erreurs** : message humain, action de réessai si possible, journal technique côté serveur, jamais de stack trace ou secret affiché.

## 36. Sécurité et isolation multi-organisation

Club A ne lit jamais Club B. Changer un ID dans l'URL ne donne jamais accès à une autre ressource. Les endpoints admin vérifient le rôle côté serveur. Les documents financiers nécessitent une permission dédiée. Les fichiers privés nécessitent des URLs signées ou un contrôle d'accès. Les fonctions serverless/edge sensibles vérifient authentification + organisation. **Rate limiting sur login, reset et formulaires publics.** Validation backend des entrées/montants/dates/IDs/fichiers. Aucun secret dans le bundle frontend.

### 36.1 Fonction déclarée vs rôle système

Cette séparation doit être explicitement vérifiée dans le code. `declared_function` peut contenir « Président », « Joueur » ou « Autre ». `system_role`/`membership_role` est attribué uniquement par une action serveur autorisée. Aucun mapping automatique depuis un formulaire public ne doit créer un administrateur.

## 37. Fichiers et uploads

Limiter formats/tailles, afficher progression si upload long, refuser fichiers invalides avec message clair, sanitiser les noms de stockage, stocker clés/URLs privées correctement, vérifier permissions au téléchargement, tester fichiers volumineux/noms spéciaux/upload interrompu.

## 38. Responsive et priorité mobile

Tester au minimum 375, 390, 430, 768, 1280, 1440px. Joueur et responsable communication utilisent probablement Connect majoritairement sur smartphone. Aucun débordement horizontal involontaire, menu mobile clair, boutons tactiles confortables, galerie rapide/fluide, calendrier lisible en liste sur petit écran, documents/tableaux en cartes si nécessaire, modales/formulaires adaptés au clavier mobile.

## 39. Accessibilité et qualité visuelle

Labels de formulaires, focus clavier visible, contrastes suffisants, texte alternatif pour images fonctionnelles, messages d'erreur associés aux champs, design system unique (boutons/cartes/badges/radius/spacing/typographies cohérents). Ne pas modifier inutilement la DA actuelle si déjà cohérente.

## 40-47. Parcours complets (référence)

Nouveau club, Responsable communication, Éducateur, Joueur, Client individuel, Demande de prestation Connect→OS, Contrat et signature, Facture et paiement — chacun décrit étape par étape dans le PDF source. Principe commun : chaque étape a un état vérifiable côté backend, jamais une simulation frontend seule.

## 48. Processus multi-organisation — préparation future

Si l'architecture permet qu'un utilisateur appartienne à plusieurs organisations, prévoir un sélecteur « Changer d'espace » (déjà existant côté Connect — `OrganizationSwitcher`). Nécessaire en V1 seulement si le besoin existe déjà. Chaque changement d'espace recalcule permissions et données visibles. Ne jamais mélanger les données de deux memberships sur le même écran sans contexte explicite.

## 49. Données et schéma fonctionnel recommandé

Ne pas imposer de refonte si les tables existantes couvrent déjà ces concepts — vérifier que l'équivalent fonctionnel existe :

| Concept | Champs / logique minimum |
|---|---|
| users | Identité, email, auth, statut, profil. |
| organizations | Nom, type, statut, données client. |
| memberships | user_id, organization_id, rôle système, statut, permissions. |
| organization_invites | email, org, rôle prévu, token hash, expiration, invité par, accepté le. |
| connect_access_requests | Structure, demandeur, fonction déclarée, besoins, statut. |
| service_requests | Organisation, créateur, type, données, statut. |
| services / prestations | Objet métier partagé avec OS, planning, production, statut. |
| visual_requests | Brief, fichiers, crédits, statut. |
| contents | Prestation, type, fichier, permissions, livraison. |
| documents | Type, organisation/client, statut, permissions, fichier. |
| invoices/orders | Montant, statut, Stripe IDs si nécessaire. |
| messages | Conversation, auteur, contenu, horodatage. |
| notifications | Utilisateur, type, ressource, lu/non lu. |
| audit_logs | Action sensible, auteur, ressource, contexte. |

## 50. Règles de nommage et cohérence

Nom produit : SportVision Connect. Club+ = offre intégrée à Connect, pas une application séparée. Supprimer les anciens noms obsolètes si encore présents. Vocabulaire de statut cohérent partout. « Mes contenus » plutôt que « Livrables » pour le joueur. Nommer précisément « Demandes de visuels » si la page ne concerne que les visuels. Ne pas appeler « Synchronisation Google Calendar » un simple bouton d'ajout.

## 51. Qualité des données et tarifs

Aucune fausse statistique en production. Aucun prix hardcodé dans plusieurs écrans. Catalogue central de prestations et options. Tarifs variables = sur devis. HT/TTC selon la nature du client et la politique commerciale réelle. Ne pas afficher de conversions type « 91,67 € HT » ou « 133,33 € HT » si elles ne correspondent pas à un tarif commercial validé. Toutes les dates en fuseau Europe/Paris pour l'affichage métier.

## 52. États et automatismes à tester

| Objet | États recommandés |
|---|---|
| Prestation | Demandée, En validation, Confirmée, Planifiée, En cours, En production, Livrée, Terminée, Annulée. |
| Demande visuel | Nouvelle, À traiter, En production, En validation, Livrée, Annulée. |
| Contrat | Brouillon, Envoyé, À signer, Signé, Expiré, Annulé. |
| Facture | À venir, En attente, Payée, En retard, Annulée. |
| Invitation | Pending, Accepted, Expired, Revoked. |
| Membership | Active, Inactive, Suspended si nécessaire. |
| Demande ouverture Connect | Nouvelle, À vérifier, Informations demandées, Validée, Refusée/Archivée. |

## 53. Tests end-to-end obligatoires

**Inscription publique d'un club** : soumettre avec fonction standard ; soumettre avec « Autre » (précision obligatoire) ; vérifier qu'aucune organisation active/admin n'est créée automatiquement ; vérifier la réception dans OS ; valider depuis OS ; recevoir l'invitation ; activer le compte ; contrôler le rôle attribué côté serveur.

**Invitation** : valide, expirée, déjà utilisée, email différent, renvoi, révocation.

**Connexion** : bonne connexion, mauvais mot de passe, reset password, session expirée, déconnexion.

**Rôles** : admin voit ses modules ; communication ne voit pas finances ; éducateur ne voit pas utilisateurs ; joueur ne voit pas documents du club ; URL directe vers page interdite = 403/404.

**Prestations** : créer demande, réception OS, changement statut OS, mise à jour Connect, planning, livraison contenu.

**Paiement et contrat** : Stripe succès/échec/webhook ; contrat Yousign test si environnement disponible ; permissions documents.

**Mobile** : admin 390px, communication 390px, joueur 375px, galerie contenu, calendrier, messagerie, formulaires.

## 54. Checklist écran par écran

| Interface | À valider |
|---|---|
| Connexion | Auth, reset, erreurs, responsive, liens. |
| Demande inscription | 4 étapes, fonction déroulante + Autre, validation serveur. |
| Activation invitation | Token, rôle serveur, mot de passe, expiration. |
| Dashboard Admin | À traiter, prochainement, contenus, demandes, offre. |
| Dashboard Communication | Demandes, crédits, contenus, événement, messages. |
| Dashboard Éducateur | Prestations, calendrier, contenus, messages. |
| Dashboard Joueur | Prochain événement, contenus, club, messages. |
| Prestations | Liste, filtre, détail, permissions. |
| Nouvelle prestation | Wizard, données dynamiques, prix, création backend. |
| Demandes visuels | Liste, création, crédits, statut. |
| Contenus | Galerie, téléchargement, permissions, mobile. |
| Calendrier | Vues, droits édition, fuseau, wording Google Calendar. |
| Rendez-vous | Fonctionnel ou masqué. |
| Documents | Devis, contrats, factures, permissions. |
| Utilisateurs | Invitation, rôle, désactivation. |
| Messages | Conversation, fichiers, non-lus. |
| Notifications | Cloche, liens, lecture. |
| Paramètres | Onglets adaptés au rôle. |
| Aide | FAQ/contact. |
| 404/403/500 | Pages propres, pas d'erreur technique exposée. |

## 55. Règles de travail pendant la session

1. Cartographier routes et composants actuels de Connect.
2. Identifier rôles et permissions réellement implémentés.
3. Comparer à la matrice de ce document.
4. Corriger d'abord les risques de sécurité et parcours cassés.
5. Puis corriger interfaces/menus selon le rôle.
6. Puis finaliser inscription, invitation, demande de prestation.
7. Puis vérifier contenus, calendrier, documents, messages, paramètres.
8. Tester les flux Connect↔OS.
9. Tester mobile et desktop.
10. Refaire un build production, corriger les erreurs bloquantes.
11. Produire un rapport final de ce qui a été modifié, testé, et ce qui reste.

**NE PAS S'ARRÊTER À L'AUDIT** : quand le problème est clair et la correction sûre, corriger puis tester. Le rapport final ne doit pas être une liste de recommandations non appliquées.

## 56. Ordre de priorité à J-5 du lancement

| Priorité | Exemples |
|---|---|
| P0 - Bloquant | Auth cassée, fuite cross-tenant, build impossible, paiement critique cassé, prise de contrôle admin. |
| P1 - Critique | Demande prestation inutilisable, documents exposés au joueur, invitation cassée, mobile principal inutilisable. |
| P2 - Important | UX confuse, états vides médiocres, filtre non essentiel cassé, wording incohérent. |
| P3 - Amélioration | Animation, micro-polish, fonction future, refactor esthétique. |

Ne pas sacrifier la stabilité pour une nouveauté P3. À J-5, fiabilité > élégance architecturale.

## 57. Explicitement hors scope V1

Espace Famille, comptes parents, rattachement enfants, albums individuels enfants, vente d'albums aux parents, reconnaissance faciale, pass photo saison, statistiques sportives avancées, scouting, réseau social interne, licences joueurs, convocations, absences entraînement, paiement des cotisations club, messagerie entre joueurs, marketplace, fonctions « bientôt disponibles » non essentielles.

## 58. Rapport final attendu

Résumé global + niveau de préparation Connect. Liste précise des modifications. Bugs corrigés. Bugs encore ouverts avec priorité. État inscriptions/invitations/auth. État de chaque rôle/interface. État du parcours de demande de prestation. État contenus/calendrier/documents/messages/paramètres. État Stripe/Yousign/services externes réellement testés. Tests cross-tenant et permissions. Tests mobile. Actions humaines encore nécessaires. Verdict GO / GO sous conditions / NO-GO.

## 59. Critères de finition V1

Un nouveau club peut demander un accès sans obtenir de droits non vérifiés. SportVision peut valider la structure et inviter le premier administrateur. L'administrateur peut inviter ses membres avec des rôles contrôlés. Chaque rôle voit un menu et un dashboard adaptés. Le joueur n'a aucun accès aux finances ou à l'administration du club. Une demande de prestation part de Connect et arrive dans OS. Une mise à jour OS revient dans Connect. Les contenus livrés sont accessibles/téléchargeables selon droits. Documents et paiements protégés. Calendrier et messages exploitables. Pages propres sur mobile. Aucun cross-tenant possible. Aucun bouton majeur décoratif. Aucune donnée fictive présentée comme réelle. Les fonctionnalités V2 sont absentes de la V1.

## 60. Instruction finale

Confronter systématiquement cette cible à l'application existante avant de modifier. Objectif : rendre l'existant cohérent, sûr et opérationnel — pas réécrire le produit. Quand une fonction existe déjà et répond correctement au besoin, la conserver. Quand un libellé est différent mais plus clair et cohérent avec l'ensemble, ne pas le changer juste pour reproduire mot à mot le PDF. En revanche, les règles de permissions, de séparation des rôles, de sécurité, de création de club et de non-attribution automatique d'un rôle admin sont **obligatoires**.

**Méthode** : ANALYSE → CORRIGE → TESTE → RETESTE → CONTINUE. Ne jamais terminer une section sur une simple hypothèse — vérifier le comportement réel dans le code et, si possible, dans l'application.

## Annexe A — Navigation finale par rôle

| Rôle | Menu V1 recommandé |
|---|---|
| Administrateur | Accueil · Prestations · Demandes · Contenus · Calendrier · Rendez-vous* · Documents · Factures · Utilisateurs · Messages · Paramètres · Aide |
| Communication | Accueil · Demandes · Contenus · Calendrier · Prestations utiles* · Messages · Profil · Aide |
| Éducateur | Accueil · Prestations ciblées · Contenus · Calendrier · Messages · Profil · Aide |
| Joueur | Accueil · Mes contenus · Calendrier · Mon club · Messages · Mon profil · Aide |
| Client individuel | Accueil · Mes prestations · Mes contenus · Rendez-vous* · Mes documents · Mes factures* · Messages · Profil |

*uniquement lorsque le module est réellement actif et pertinent.

## Annexe B — Résumé du processus d'accès

**Nouveau club** : Vitrine → Demande d'ouverture → Validation SportVision dans OS → Création organisation → Invitation sécurisée → Activation → Onboarding → Dashboard Admin.

**Membre d'un club** : Admin Connect → Invitation avec rôle préattribué → Activation → Dashboard adapté au rôle.

**Connexion** : Email + mot de passe → Serveur charge memberships, rôle, offre, permissions → Interface adaptée. Aucun sélecteur de rôle.

**Mot de passe oublié** : Email → lien temporaire → nouveau mot de passe → connexion.

## Annexe C — Checklist de test rapide avant GO

- Créer une demande publique de club avec « Autre ».
- Vérifier qu'aucun admin n'est créé automatiquement.
- Valider depuis OS et activer le premier admin.
- Inviter Communication, Éducateur et Joueur.
- Se connecter avec chaque rôle.
- Vérifier les menus et URLs directes interdites.
- Créer une demande prestation depuis Admin.
- Vérifier sa réception dans OS.
- Modifier le statut depuis OS et vérifier Connect.
- Livrer un contenu et le télécharger avec le bon rôle.
- Vérifier qu'un joueur ne voit aucun document financier.
- Tester messages et notifications.
- Tester reset password.
- Tester mobile 375/390px.
- Tester Club A contre Club B.
- Tester build production et console.
- Tester Stripe/Yousign si actifs.
- Faire un dernier smoke test en navigation privée.
