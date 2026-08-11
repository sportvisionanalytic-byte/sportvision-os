# MASTER PROMPT — SPORTVISION CONNECT V1

Architecture fonctionnelle complète, interfaces, rôles, inscription et parcours utilisateurs.

**Document maître de référence produit pour SportVision Connect V1**, rédigé par Fouka le 11/08/2026. À donner en contexte avant de faire auditer ou modifier une page précise de Connect ("audite la page Prestations en respectant strictement le Master Connect"). Objectif : éviter qu'un agent recrée des fonctions qui contredisent le reste de l'application.

Tu travailles sur SportVision Connect, la plateforme client centrale de SportVision.

Ce document constitue la référence fonctionnelle générale de SportVision Connect V1.

Avant de modifier ou créer une fonctionnalité, comprends cette logique globale.

L'objectif n'est pas de créer un simple dashboard SaaS générique.

SportVision Connect doit devenir le point de contact numérique entre :

SPORTVISION
↓
CLUBS / ACADÉMIES / STRUCTURES / CLIENTS
↓
MEMBRES AUTORISÉS / JOUEURS
↓
PRESTATIONS / CONTENUS / DOCUMENTS / ÉCHANGES

## 1. QU'EST-CE QUE SPORTVISION CONNECT ?

SportVision Connect est l'espace client officiel de SportVision.

Il permet aux clients et utilisateurs autorisés de centraliser leur relation avec SportVision.

Depuis Connect, selon leurs droits, ils peuvent notamment :

consulter leurs prestations ; demander une prestation ; suivre une demande ; demander un visuel ; récupérer leurs contenus ; voir leur calendrier ; consulter leurs rendez-vous ; consulter leurs devis ; consulter leurs contrats ; consulter leurs factures ; signer certains documents via le processus prévu ; échanger avec SportVision ; gérer leur organisation ; inviter des utilisateurs ; gérer leur profil ; suivre leur offre SportVision ; consulter leurs crédits lorsque l'offre en utilise.

Connect ne doit PAS devenir un logiciel généraliste de gestion de club.

Il ne doit pas chercher à remplacer : SportEasy ; TeamPulse ; un logiciel de licences ; un ERP de club ; un logiciel de comptabilité.

SportVision Connect reste centré sur : la relation entre le client et SportVision.

## 2. CONNECT ET SPORTVISION OS SONT DEUX CHOSES DIFFÉRENTES

**SportVision Connect** : côté CLIENT. L'utilisateur demande, consulte, échange et récupère.

**SportVision OS** : côté SPORTVISION. L'équipe SportVision reçoit, traite, attribue, produit, facture et pilote.

Exemple : Club crée une demande dans Connect → La demande apparaît dans SportVision OS → SportVision la traite → Le statut est mis à jour → La mise à jour revient dans Connect.

Il ne faut pas créer deux données séparées. Il doit s'agir du même objet métier, vu depuis deux interfaces différentes.

## 3. ARCHITECTURE DES COMPTES

Connect fonctionne selon : ORGANISATION puis : UTILISATEURS.

Exemple : FC Montereau peut contenir : Président ; Responsable communication ; Community Manager ; éducateur ; joueur.

Tous disposent éventuellement d'un compte Connect mais ils n'ont PAS les mêmes permissions.

## 4. TYPES DE CLIENTS

Prévoir notamment : CLUB, ACADÉMIE, STAGE / CAMP, PRÉPARATEUR PHYSIQUE, ORGANISATEUR DE TOURNOI, ASSOCIATION, ENTREPRISE / MARQUE, CLIENT INDIVIDUEL, ESPACE PROJET.

« Espace Projet » peut être utilisé lorsqu'un client travaille avec SportVision sur une mission ponctuelle sans nécessiter toute l'architecture d'un club.

## 5. RÈGLE ABSOLUE D'INSCRIPTION

Un utilisateur ne doit JAMAIS pouvoir choisir librement son rôle lors d'une inscription publique.

INTERDIT : Nom / Email / Mot de passe / « Je suis : Admin ».

La permission est déterminée côté serveur. C'est une règle de sécurité fondamentale.

## 6. CRÉATION D'UNE NOUVELLE ORGANISATION

Pour la V1, privilégier un processus contrôlé. Lorsqu'un nouveau client signe avec SportVision :

SportVision crée l'organisation dans SportVision OS ; l'organisation est synchronisée avec Connect ; SportVision désigne le premier administrateur client ; Connect génère une invitation ; le client reçoit un e-mail ; il crée son mot de passe ; son compte est associé à son organisation ; son rôle est attribué côté serveur ; il accède à Connect.

Exemple : « Bienvenue sur SportVision Connect — FC Montereau vous invite à accéder à son espace SportVision. » CTA : Activer mon compte.

## 7. PREMIER ADMINISTRATEUR DU CLIENT

Le premier compte créé reçoit par exemple : organization_admin.

Ce rôle ne doit jamais être obtenu depuis une valeur envoyée directement par le navigateur. Il doit être créé par : SportVision ; une invitation sécurisée ; ou une procédure serveur autorisée.

## 8. INVITER D'AUTRES UTILISATEURS

Depuis : Utilisateurs — un administrateur autorisé peut inviter un autre membre.

Champs : prénom ; nom ; e-mail ; rôle. Les rôles proposés dépendent de l'organisation.

Exemple club : Administrateur ; Communication ; Éducateur ; Joueur.

L'utilisateur reçoit : « FC Montereau vous invite sur SportVision Connect. »

Le token d'invitation doit : être sécurisé ; être temporaire ; ne pas être prédictible ; être invalidé après utilisation.

## 9. CONNEXION

Page : Se connecter à SportVision Connect. Champs : adresse e-mail ; mot de passe. Actions : Se connecter / Mot de passe oublié ? / Besoin d'aide ?

Ne pas présenter de rôle à sélectionner. Connect retrouve automatiquement : le compte ; l'organisation ; le rôle ; les modules autorisés.

## 10. MOT DE PASSE OUBLIÉ

Processus : saisie email ; email sécurisé ; lien temporaire ; nouveau mot de passe ; confirmation ; retour connexion.

Ne jamais révéler publiquement si une adresse appartient ou non à un client lorsque ce n'est pas nécessaire.

## 11. PREMIÈRE CONNEXION

Étape 1 : Bienvenue. Étape 2 : Informations personnelles (prénom ; nom ; téléphone facultatif selon besoin ; photo facultative). Étape 3 : Acceptations nécessaires. Étape 4 : Présentation courte de Connect.

Maximum 3 écrans. Ne pas créer un onboarding de 15 étapes.

## 12. INTERFACE GLOBALE

Toutes les interfaces Connect reposent sur la même architecture visuelle.

**Sidebar** : Logo SportVision Connect, puis profil ; organisation ; rôle. Navigation adaptée automatiquement aux permissions.

**Topbar** : recherche ; nouvelle demande lorsque autorisée ; notifications ; aide ; thème si disponible ; avatar.

## 13. RECHERCHE GLOBALE

La barre « Rechercher un contenu, une demande... » doit pouvoir chercher uniquement dans les données accessibles à l'utilisateur (contenu ; prestation ; demande ; document). Jamais dans les données d'une autre organisation.

## 14. NOTIFICATIONS

Centre de notifications. Exemples : « Votre prestation a été confirmée. » « Votre contrat est disponible. » « Votre demande de visuel est en cours. » « 23 nouveaux contenus ont été livrés. » « Vous avez reçu un message. » « Votre rendez-vous est demain à 14h. »

Chaque notification doit rediriger vers la bonne ressource.

## 15. INTERFACE ADAPTATIVE

IMPORTANT : Connect ne doit PAS simplement afficher toutes les pages avec des cadenas.

Les menus doivent être générés selon : rôle ; contrat ; organisation ; permissions ; modules actifs.

Si un joueur n'a pas accès à « Utilisateurs » : ne pas afficher Utilisateurs.

Si un module n'existe pas dans son offre : soit il est caché ; soit exceptionnellement présenté comme upsell lorsqu'il existe une vraie raison commerciale.

Éviter une interface remplie de cadenas.

## 16. RÔLE — ADMINISTRATEUR D'ORGANISATION

Exemple : Président de club / dirigeant / responsable principal.

Navigation complète : Accueil, SportVision, Prestations, Demandes, Contenus, Calendrier, Rendez-vous, Gestion, Documents, Factures, Utilisateurs, Messages, Compte, Paramètres, Aide.

Peut également voir son offre.

## 17. DASHBOARD ADMINISTRATEUR

Titre : « Bonjour [Prénom], voici ce qui nécessite votre attention. »

Afficher prioritairement :
- **À traiter** : documents à signer ; factures ; demandes nécessitant une réponse ; rendez-vous ; autres actions.
- **Prochainement** : prochaine prestation ; prochain tournage ; prochain rendez-vous.
- **Derniers contenus**
- **Dernières demandes**
- **État de l'offre**

Ne pas remplir artificiellement le dashboard. S'il n'existe aucune donnée : utiliser un état vide professionnel.

## 18. ESPACE JOUEUR

Le compte joueur doit être une interface spécifique. Il ne doit PAS être une copie du compte administrateur.

Navigation recommandée : Accueil, Mon espace, Mes contenus, Calendrier, Mon club, SportVision, Messages, Compte, Mon profil, Aide.

Si les prestations individuelles sont activées : Prestations, Mes demandes peuvent également apparaître.

## 19. DASHBOARD JOUEUR

Titre : « Bonjour [Prénom] 👋 Bienvenue dans votre espace joueur. » Ou : « Retrouvez vos contenus et les prochains événements liés à votre club. »

Afficher : Prochain événement ; Derniers contenus ; Nouveaux contenus disponibles ; Mon club ; Messages récents ; Favoris si disponible.

Ne pas afficher : CA ; contrats du club ; factures du club ; crédits du club ; utilisateurs ; gestion d'offre.

## 20. MON CLUB — JOUEUR

Page simple. Afficher : logo ; nom du club ; équipe/catégorie si renseignée ; rôle ; saison.

Exemple : « FC Montereau — U18 R2 — Joueur »

Ne pas transformer cette page en outil de gestion sportive.

## 21. PRESTATIONS

Page : Prestations. Montre les prestations SportVision associées au client.

Statuts possibles : demande ; à valider ; confirmée ; planifiée ; en cours ; en production ; livrée ; terminée ; annulée.

Chaque prestation dispose d'une fiche.

## 22. FICHE PRESTATION

Afficher selon le besoin :
- **Informations** : type ; date ; heure ; lieu ; client ; statut.
- **Production** : état ; livrables ; délais.
- **Équipe SportVision** si pertinent.
- **Documents liés**
- **Paiement** uniquement pour utilisateurs financiers autorisés.
- **Historique**

## 23. NOUVELLE DEMANDE DE PRESTATION

CTA : Demander une prestation. Parcours en 5 étapes.

**ÉTAPE 1 — TYPE DE PRESTATION** : Catalogue contrôlé depuis une source centrale. Exemples : Match Photo, Match Vidéo, Pack Match Complet, Shooting, Couverture Tournoi, Couverture Stage, Création de contenu, Match filmé caméra Veo, Veo + Photo, Drone, Drone + Photo.

Ne pas hardcoder des prix dans plusieurs composants. Utiliser une seule source tarifaire.

## 24. AFFICHAGE DES PRIX

Entreprise / club : prix HT. Particulier : prix TTC.

Ne jamais afficher automatiquement « 133,33 € HT » simplement parce qu'on a divisé un tarif TTC si ce prix n'a pas été commercialement validé.

Tous les tarifs de production doivent venir du catalogue validé. Pour les prestations variables : Sur devis.

## 25. ÉTAPE 2 — INFORMATIONS ET LIEU

Champs possibles : date ; heure ; adresse ; équipe ; adversaire ; niveau/catégorie ; description ; nombre de participants selon prestation.

Les champs doivent être dynamiques selon le service. Un shooting n'a pas besoin exactement des mêmes informations qu'un tournoi.

## 26. ÉTAPE 3 — OPTIONS

Selon prestation : drone ; seconde caméra ; montage supplémentaire ; livraison particulière ; autre option réellement disponible.

Ne jamais afficher une option indisponible.

## 27. ÉTAPE 4 — TARIFICATION

Afficher : prestation ; options ; frais connus ; estimation ; TVA ; total selon type client.

Si le tarif ne peut pas être déterminé : Demande de devis, et non un faux prix.

## 28. ÉTAPE 5 — RÉCAPITULATIF

Résumé : service ; date ; lieu ; options ; estimation ; informations importantes.

CTA : Envoyer ma demande. Puis : « Votre demande a bien été envoyée. »

## 29. APRÈS UNE DEMANDE

Créer une demande réelle en base. La transmettre à SportVision OS. Créer notification SportVision.

Afficher dans Connect : Demande reçue, puis les statuts.

Ne jamais simuler un succès frontend sans enregistrement réel.

## 30. CLUB VS JOUEUR POUR LES PRESTATIONS

Un club peut avoir accès aux prestations B2B : match ; tournoi ; stage ; Veo ; drone ; Full Communication ; création contenu.

Un joueur particulier ne doit pas nécessairement voir ces prestations.

Si l'offre joueur existe, montrer seulement : shooting individuel ; suivi individuel ; contenu joueur ; prestations personnelles réellement commercialisées.

## 31. DEMANDES DE VISUELS

Pour les clients disposant de cette fonctionnalité : Demandes de visuels. Filtres : Toutes ; En cours ; Livrées. CTA : Nouvelle demande de visuel.

## 32. CRÉATION D'UNE DEMANDE DE VISUEL

Demander : type de visuel ; titre ; brief ; textes ; couleurs/instructions ; fichiers ; date souhaitée.

Types possibles : affiche avant-match ; composition ; résultat ; joueur du match ; événement ; autre.

Envoi : Connect → OS → équipe concernée.

## 33. CRÉDITS

Si l'offre utilise des crédits : Afficher Crédits disponibles, ex. « 8 / 20 crédits ».

Lors de la demande : Connect doit indiquer le coût éventuel. Ne jamais permettre un solde négatif sauf autorisation métier explicite.

## 34. CONTENUS

Page : Mes contenus. Préférer « contenus » à « livrables » pour les utilisateurs non techniques.

Catégories : Tous, Photos, Vidéos, Reels, Affiches. Documents administratifs restent dans « Documents ».

## 35. ORGANISATION DES CONTENUS

Regrouper idéalement par événement / prestation. Exemple : « FC Montereau vs Sens — 12 août 2026 » puis « 42 photos ; 3 vidéos ; 1 reel ». CTA : Voir les contenus.

## 36. FICHE CONTENU

Permettre selon droits : aperçu ; téléchargement ; téléchargement HD ; téléchargement multiple. Possibilité V1 simple : Tout télécharger.

## 37. FAVORIS

Si implémenté : ❤️ Ajouter aux favoris. Le favori est personnel. Une organisation ne doit pas voir automatiquement les favoris d'un utilisateur.

## 38. CALENDRIER

Page : Calendrier. Vues : Mois, Semaine, Jour, Liste. Afficher : prestations ; tournages ; publications si pertinentes ; rendez-vous ; échéances.

## 39. PERMISSIONS CALENDRIER

Admin client : peut éventuellement créer certains événements autorisés. Joueur : lecture principalement. Ne pas permettre au joueur de modifier le calendrier officiel du club.

## 40. EXPORT CALENDRIER

Possibilité : Exporter iCal, ou Ajouter à Google Calendar.

Si aucune vraie synchronisation bidirectionnelle n'existe : ne jamais écrire « Synchronisation automatique Google Calendar. »

## 41. RENDEZ-VOUS

Page : Mes rendez-vous. Lorsqu'activé : rendez-vous à venir ; rendez-vous passés ; date ; heure ; interlocuteur ; lien ou lieu.

CTA : Prendre un rendez-vous si réellement disponible. Sinon masquer le module plutôt que montrer un cadenas permanent.

## 42. DOCUMENTS

Page : Mes documents. Catégories : Tous, Devis, Factures, Contrats. Mais uniquement pour les personnes autorisées.

## 43. DOCUMENTS — PERMISSIONS

Administrateur financier : peut accéder aux documents de son organisation.

Joueur : ne voit PAS contrats club ; devis club ; factures club.

Responsable communication : ne doit pas automatiquement accéder aux finances. Utiliser permissions fines.

## 44. DOCUMENTS JOUEUR

Si un joueur achète une prestation personnellement : il peut uniquement consulter ses propres documents. Jamais ceux du club.

## 45. DEVIS

Statuts : disponible ; accepté ; refusé ; expiré. Afficher : numéro ; date ; montant ; prestation ; téléchargement.

## 46. CONTRATS

Afficher : contrat ; statut ; date ; signature. Statuts : brouillon ; envoyé ; à signer ; signé ; expiré ; annulé.

La signature passe par le processus sécurisé de signature électronique. Un client ne doit jamais pouvoir modifier directement son statut en : signé.

## 47. FACTURES

Afficher aux personnes autorisées : numéro ; date ; montant ; statut ; échéance ; téléchargement. Statuts : à venir ; en attente ; payée ; en retard ; annulée.

## 48. PAIEMENTS

Stripe doit être la source de vérité pour les paiements qui passent par Stripe.

Workflow : Connect → Stripe → Webhook serveur → mise à jour base → OS → Connect.

Le frontend seul ne doit jamais transformer une commande en « payée ».

## 49. UTILISATEURS

Page réservée aux administrateurs autorisés. Afficher : nom ; email ; rôle ; statut. Actions : inviter ; changer rôle ; désactiver ; renvoyer invitation.

## 50. RÔLES D'UNE ORGANISATION

- **ADMINISTRATEUR** : Tout le périmètre client autorisé.
- **COMMUNICATION** : Contenus + demandes visuels + calendrier éventuellement.
- **ÉDUCATEUR** : Contenus/calendrier selon configuration.
- **JOUEUR** : Contenus + calendrier + messages + profil.

Les rôles doivent être extensibles.

## 51. MESSAGERIE

Page : Messages. Objectif : permettre d'échanger simplement avec SportVision. Ne pas recréer WhatsApp ou Slack. Une conversation claire suffit.

## 52. STRUCTURE MESSAGERIE

Liste à gauche sur desktop. Conversation à droite. Afficher : interlocuteur ; messages ; date ; statut lecture si disponible. Champ : « Écrivez votre message... » Actions possibles : envoyer ; joindre fichier si nécessaire.

## 53. INTERLOCUTEUR

Afficher par exemple : « Équipe SportVision » ou « Votre interlocuteur SportVision ». Éviter d'inventer un système de présence (« En ligne ») si aucune vraie présence temps réel n'existe.

## 54. PARAMÈTRES ADMINISTRATEUR

Onglets possibles : Personnel, Organisation, Intégrations — uniquement quand ces modules sont réellement accessibles.

## 55. PARAMÈTRES PERSONNELS

photo ; prénom ; nom ; téléphone ; email ; langue ; mot de passe ; préférences notifications.

## 56. PARAMÈTRES ORGANISATION

Pour administrateur uniquement : logo ; nom ; type ; informations de contact ; utilisateurs ; informations nécessaires.

Ne pas permettre de modifier des données juridiques sensibles sans contrôle si celles-ci impactent les contrats.

## 57. PARAMÈTRES JOUEUR

Pour joueur : ne pas afficher Organisation, Intégrations.

Afficher Mon profil (photo ; prénom ; nom ; téléphone ; email ; mot de passe ; notifications). Puis éventuellement Mon club en lecture seule.

## 58. INTÉGRATIONS

Afficher uniquement les intégrations réellement disponibles. Ne pas créer « Bientôt disponible » partout.

À cinq jours d'un lancement : si une fonctionnalité n'existe pas réellement, la masquer.

## 59. OFFRES SPORTVISION

Connect doit comprendre le contrat du client. Exemples : Prestation ponctuelle, Club+, Full Communication, autre abonnement.

Les modules disponibles changent selon cette offre.

## 60. CARTE OFFRE

Sur un compte administrateur, on peut afficher : « Full Communication — ACTIF » ou « Club+ Performance — ACTIF ». Puis éventuellement : crédits ; présence ; renouvellement ; informations utiles.

CTA : Gérer mon offre uniquement si une vraie page existe.

## 61. OFFRE SUR COMPTE JOUEUR

Ne PAS afficher : crédits du club, gérer mon offre à un simple joueur.

À la place, éventuellement afficher : « FC Montereau — Joueur — U18 R2 » ou rien.

## 62. FULL COMMUNICATION

Pour un client Full Communication, Connect peut donner accès à : prestations ; calendrier ; contenus ; demandes ; communication ; documents ; messages.

L'administration détaillée reste dans OS.

## 63. CLUB+

Club+ est une OFFRE de SportVision. Ce n'est plus une application séparée. Tout se passe dans SPORTVISION CONNECT.

Ne jamais recréer « Portail SportVision » ou « application Club+ ».

## 64. ACCÈS CONDITIONNELS

Utiliser une matrice du type :

| Fonction | Admin club | Communication | Joueur |
|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ |
| Prestations club | ✅ | selon droits | ❌ |
| Demandes visuels | ✅ | ✅ | ❌ |
| Contenus | ✅ | ✅ | ✅ |
| Calendrier | ✅ | ✅ | ✅ lecture |
| Rendez-vous | ✅ | selon offre | si nécessaire |
| Documents financiers | ✅ | selon permission | ❌ |
| Utilisateurs | ✅ | ❌ | ❌ |
| Messages | ✅ | ✅ | ✅ |
| Organisation | ✅ | ❌ | ❌ |
| Offre/crédits | ✅ | selon besoin | ❌ |

## 65. AIDE & SUPPORT

Accessible depuis tous les comptes. Page : Aide SportVision. Possibilités simples : FAQ ; nous contacter ; message SportVision ; email/support.

Ne pas développer un centre de tickets complexe en V1 sauf s'il existe déjà.

## 66. EMPTY STATES

Chaque interface vide doit expliquer : ce qu'est la page ; pourquoi elle est vide ; quelle action faire.

Mauvais : « Aucun élément. »

Meilleur : « Aucun contenu pour le moment. Vos prochains contenus apparaîtront automatiquement ici après leur livraison. »

## 67. LOADING

Chaque requête doit disposer d'un état loading. Prévoir : skeleton ; spinner raisonnable ; bouton désactivé.

Éviter : double envoi ; double réservation ; double paiement.

## 68. ERREURS

Messages humains. Exemple : « Impossible d'envoyer votre demande. Réessayez dans quelques instants. » Pas : « PostgreSQL constraint violation 23505. »

## 69. RESPONSIVE

Toutes les interfaces doivent être utilisables sur mobile ; tablette ; desktop.

Sur téléphone : la sidebar devient menu/drawer. Les tableaux complexes deviennent : cartes ; listes ; scroll contrôlé.

## 70. SÉCURITÉ MULTI-ORGANISATION

Club A ne doit jamais accéder aux données Club B. Même en modifiant : URL ; ID ; API request ; payload.

Les contrôles doivent exister côté serveur.

## 71. SÉCURITÉ DES JOUEURS

Un joueur ne doit jamais obtenir accidentellement : finances club ; annuaire complet ; contrats ; données administratives ; paramètres organisation ; informations d'un autre club.

## 72. FICHIERS

Les fichiers privés ne doivent pas avoir des URLs publiques permanentes. Utiliser : stockage sécurisé ; contrôle permissions ; URLs signées/temporaire lorsque nécessaire.

## 73. AUDIT LOG

Journaliser les actions sensibles : invitation ; rôle ; suppression utilisateur ; document ; signature ; paiement ; changement organisation ; prestation.

## 74. PARCOURS COMPLET — NOUVEAU CLUB

SportVision signe FC Montereau → SportVision OS crée FC Montereau → SportVision crée/invite le président → Président reçoit email → Il active son compte → Il se connecte → Dashboard Connect → Il demande une prestation → La demande apparaît dans SportVision OS → SportVision valide → Connect affiche : Confirmée → La prestation apparaît dans le calendrier → SportVision réalise la prestation → Contenus livrés → Notification Connect → Le client récupère ses fichiers → Documents associés restent accessibles selon permissions.

## 75. PARCOURS — NOUVEAU JOUEUR

Président/admin autorisé : Inviter un joueur → Le joueur reçoit l'invitation → Il active son compte → Il arrive dans Espace Joueur.

Il voit : club ; prochains événements ; contenus ; messages ; calendrier ; profil.

Il ne voit PAS : factures club ; devis ; contrats club ; autres utilisateurs ; gestion offre.

## 76. PARCOURS — CLIENT PONCTUEL

SportVision crée Espace Projet ou compte client ponctuel. Le client reçoit son accès.

Son Connect simplifié peut afficher : prestation ; statut ; messages ; documents propres ; contenus ; calendrier/rendez-vous si nécessaire.

Ne pas lui donner toute l'interface Club.

## 77. PARCOURS — DEMANDE VISUEL

Connect → Nouvelle demande de visuel → Brief → Pièces jointes → Validation crédits si applicable → Envoi → SportVision OS → Attribution interne → En production → Livrée → Notification → Connect → Téléchargement.

## 78. PARCOURS — CONTRAT

OS crée le contrat → Connect affiche : Document à signer → Processus de signature électronique → Webhook sécurisé → Statut : Signé → OS + Connect mis à jour.

## 79. PARCOURS — FACTURE

Facture créée → Utilisateur financier autorisé la voit → Notification si nécessaire → Paiement si paiement Connect réellement prévu → Webhook Stripe → Statut : Payée.

## 80. CE QUI EST EXCLU DE CONNECT V1

NE PAS implémenter maintenant : Espace Famille ; comptes parents ; albums enfants ; vente photos parents ; reconnaissance faciale ; réseau social ; scouting ; statistiques sportives avancées ; licences joueurs ; convocations équipe ; absences entraînement ; classement ; paiement cotisations club ; chat interne entre joueurs ; marketplace ; fonctionnalités non validées.

## 81. PHILOSOPHIE PRODUIT

Pour chaque écran, se poser la question : Pourquoi cet utilisateur vient-il ici ?

Un président vient pour : gérer la relation de son club avec SportVision.
Un responsable communication vient pour : organiser les demandes et récupérer les contenus.
Un joueur vient pour : retrouver ses contenus et les informations SportVision qui le concernent.
Un client ponctuel vient pour : suivre sa prestation.

L'interface doit changer en conséquence.

## 82. RÈGLE UX FONDAMENTALE

Ne pas construire : une interface admin unique + 50 cadenas.

Construire : UNE INTERFACE ADAPTÉE AU RÔLE.

Chaque utilisateur ne voit que : ce qui lui est utile ; ce qu'il est autorisé à utiliser.

## 83. RÈGLE DE DÉVELOPPEMENT

Avant d'ajouter une nouvelle page : vérifier si une page existante remplit déjà le besoin.
Avant d'ajouter une table : vérifier si la donnée existe déjà.
Avant de créer une nouvelle logique : vérifier SportVision OS.

Éviter toute duplication entre OS et Connect.

## 84. SOURCE DE VÉRITÉ

SportVision OS et Connect utilisent les mêmes objets métier.

Exemple : `service_request` ne doit pas avoir `connect_request` puis `os_request` sans relation claire. Un seul objet. Différentes interfaces.

## 85. OBJECTIF FINAL DE CONNECT V1

Lorsqu'un nouveau club reçoit ses accès, il doit pouvoir comprendre l'application sans formation lourde. En moins de quelques minutes, il doit savoir : où sont mes prestations ? comment demander quelque chose ? où récupérer mes contenus ? où sont mes documents ? comment contacter SportVision ?

Et un joueur doit immédiatement comprendre : où sont mes contenus ? quel est mon prochain événement ? comment contacter SportVision ?

Si cette compréhension n'est pas immédiate, simplifier l'interface.

## 86. RÉSULTAT ATTENDU

SportVision Connect V1 doit donner l'impression d'un produit professionnel conçu spécifiquement pour SportVision. Pas d'un template SaaS générique.

Le fonctionnement global doit être :

CLIENT demande → CONNECT centralise → SPORTVISION OS traite → ÉQUIPE SPORTVISION réalise → CONNECT restitue → CLIENT consulte et récupère.

L'ensemble doit être : simple, cohérent, sécurisé, rapide et compréhensible.
