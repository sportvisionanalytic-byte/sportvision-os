# Deux prompts à coller dans l'extension Claude du navigateur

Un par magasin. Ils sont indépendants, fais-les dans l'ordre que tu veux.

Les deux clés se téléchargent en **fichier**. Tu n'as rien à recopier : note où le fichier est
descendu (en général `~/Downloads`) et donne-moi le chemin, je le lis et je pose le secret.

---

## 1. Apple — clé d'API App Store Connect

Lien : **https://appstoreconnect.apple.com/access/integrations/api**

### Le prompt

```
Tu es dans App Store Connect, connecté au compte ELKANA GROUP (Team ID H2J6ZBKXQD).
Aide-moi à faire ces quatre choses, dans cet ordre, en me disant à chaque étape ce que tu vois
avant d'agir. Si une page demande une confirmation d'identité ou un paiement, arrête-toi et
dis-le-moi : je le ferai moi-même.

ÉTAPE 1 — Vérifier l'accord Paid Applications.
Va dans Business (ou « Accords, taxes et banque » selon la langue). Dis-moi si l'accord
« Paid Applications » est Actif, en attente, ou absent, et s'il manque des informations bancaires
ou fiscales. Ne signe rien : dis-moi juste l'état exact.

ÉTAPE 2 — Le programme Small Business.
Vérifie si le compte est inscrit à l'App Store Small Business Program. Si non, dis-moi où est le
formulaire. C'est ce qui fait passer la commission de 30 % à 15 %.

ÉTAPE 3 — Créer deux achats intégrés.
Dans l'app SportVision (bundle fr.sportvision.app) → Monetization → In-App Purchases.
Crée DEUX produits de type « Consumable » (consommable, surtout pas non-consommable) :

  Product ID : pass_photo_19_99   Prix : 19,99 €   Nom de référence : Pass Photo Villemomble
  Product ID : pass_photo_39_99   Prix : 39,99 €   Nom de référence : Pass Photo Fontainebleau

Les Product ID doivent être exactement ceux-ci, au caractère près : le serveur les compare tels
quels et un écart fait refuser l'achat. Pour le nom affiché et la description, mets
« Pass Photo saison 2026-2027 » et « Accès à vos photos de la saison, dans l'application et sur
le web. » Laisse la capture d'écran de revue de côté, je te la donnerai.

ÉTAPE 4 — Créer la clé d'API.
Users and Access → onglet Integrations → App Store Connect API → Team Keys → génère une clé
nommée « SportVision serveur » avec le rôle Admin.
Puis dis-moi TROIS choses :
  - le Key ID (dix caractères) ;
  - l'Issuer ID (l'UUID affiché en haut de la page) ;
  - confirme que le fichier .p8 a bien été téléchargé, et dans quel dossier.
Ne recopie PAS le contenu du fichier .p8 dans la conversation. Il ne se télécharge qu'une seule
fois : si le téléchargement échoue, dis-le-moi tout de suite au lieu de recréer une clé.
```

---

## 2. Google — compte de service Play

Lien : **https://play.google.com/console** puis, dans l'app, *Configuration → Accès à l'API*.

### Le prompt

```
Tu es dans Google Play Console, sur le compte développeur d'Elkana Group.
L'application SportVision (package fr.sportvision.app) n'est peut-être pas encore créée.
Aide-moi à faire ces quatre choses dans cet ordre, en me disant à chaque étape ce que tu vois
avant d'agir. Si quelque chose demande un paiement, une pièce d'identité ou une vérification
d'entreprise, arrête-toi et dis-le-moi.

ÉTAPE 1 — L'application existe-t-elle ?
Cherche une app dont le package est fr.sportvision.app. Dis-moi si elle existe, et sinon
guide-moi pour la créer (nom : SportVision, type : application, gratuite avec achats intégrés).
Ne remplis pas la fiche Play Store complète, on la fera après.

ÉTAPE 2 — Où envoyer le paquet.
Trouve la page permettant d'envoyer un AAB sur une piste de test interne, et donne-moi son
adresse. J'ai le fichier prêt en local, je l'enverrai moi-même. Important à savoir : les produits
in-app ne peuvent être créés qu'APRÈS qu'un paquet déclarant la facturation ait été envoyé.

ÉTAPE 3 — Créer deux produits in-app (seulement si l'étape 2 est déjà faite).
Monétisation → Produits → Produits in-app → créer :

  ID : pass_photo_19_90   Prix : 19,90 €
  ID : pass_photo_39_90   Prix : 39,90 €

Les ID doivent être exactement ceux-ci. Google n'impose aucun palier de prix, mets donc bien
19,90 et 39,90 et non 19,99 et 39,99. Titre : « Pass Photo saison 2026-2027 ».
Chaque produit doit finir ACTIF, sinon l'application ne le voit pas.

ÉTAPE 4 — Le compte de service.
Configuration → Accès à l'API. Puis :
  a) si aucun projet Google Cloud n'est lié, dis-moi comment en lier un ;
  b) crée un compte de service, et une clé au format JSON ;
  c) reviens dans Accès à l'API et donne à ce compte de service, sur l'application SportVision,
     les autorisations « Voir les données financières » et « Gérer les commandes et les
     abonnements ».
Dis-moi ensuite dans quel dossier le fichier JSON a été téléchargé. Ne recopie PAS son contenu
dans la conversation.
Précise-moi aussi l'heure : l'autorisation met parfois jusqu'à 24 h à se propager, et un refus
le premier jour ne veut pas dire que la configuration est fausse.

ÉTAPE 5 — Un compte de test.
Configuration → Test de licence : ajoute l'adresse Google d'Elkana Group. Les achats faits depuis
ce compte ne seront pas débités.
```

---

## Ce que tu me rends, au bout du compte

| Apple | Google |
|---|---|
| le Key ID (10 caractères) | — |
| l'Issuer ID (un UUID) | — |
| le chemin du fichier `.p8` | le chemin du fichier `.json` |

Je pose les secrets, puis je teste un achat de bout en bout sur chaque magasin.
