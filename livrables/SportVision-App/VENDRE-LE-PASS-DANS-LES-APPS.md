# Vendre le Pass Photo sur l'App Store

Décision de Fouka, 25/09/2026 : « j'accepte qu'Apple prenne 15 %, pour que les gens puissent
payer et déverrouiller le Pass directement sur l'application ».

Tout le code est écrit, déployé et testé. Ce qui reste demande un accès à App Store Connect,
donc c'est toi.

---

## Les trois chemins, et ce qu'ils rapportent

| Chemin | Qui encaisse | Ce que tu gardes | Où c'est proposé |
|---|---|---|---|
| Dans l'app iPhone | Apple | ~33,99 € sur 39,99 € (15 %) | Bouton dans la galerie |
| Dans l'app Android | Google | ~33,92 € sur 39,90 € (15 %) | Bouton dans la galerie |
| Lien Stripe ou QR code | toi, via Stripe | ~38,60 € sur 39,90 € (1,4 % + 0,25 €) | Connect web, QR, WhatsApp du club |
| Espèces ou virement au club | toi, directement | 39,90 € | Onglet « Accès payés au club » dans l'OS |

Les deux magasins coûtent la même chose. Le QR code Stripe te rapporte **4,70 € de plus par Pass**,
et l'encaissement au club **6 €**. Sur cent Pass, c'est 470 à 600 € d'écart : ça vaut la peine de
distribuer le QR code partout où c'est permis, c'est-à-dire partout sauf dans les apps.

### Google Play aussi, et pourquoi

J'avais écrit que « Google autorise un lien de paiement externe ». C'était trop affirmatif : Play
exige aussi son propre système de facturation pour le contenu numérique, et l'ouverture imposée par
le DMA dans l'EEE passe par un programme d'inscription, pas par un simple lien.

Tu as tranché pour l'achat intégré des deux côtés. Le bouton Android n'ouvre donc plus Connect, il
achète. C'était l'option la plus sûre : mieux vaut un quatrième chemin conforme qu'un refus au
dépôt sur Play, surtout que l'app n'y est pas encore publiée.

**Une différence à connaître : Google accepte le prix exact, Apple non.** Le même Pass coûtera
39,90 € sur Android et 39,99 € sur iPhone, parce qu'Apple impose ses paliers. L'app affiche
toujours le prix que le magasin lui donne, jamais celui du club, donc personne ne verra un prix
différent de ce qui lui sera prélevé.

---

**Le chemin Apple est le plus cher des trois.** Il n'est pas là pour remplacer les autres, il est
là pour capter la famille qui ne veut ni chercher un lien ni appeler le coach. Le QR code reste
ta meilleure marge, et rien n'empêche de le distribuer partout hors de l'app : au bord du terrain,
sur un flyer, dans le groupe du club. Apple n'a aucun droit de regard là-dessus. Ce qu'il interdit,
c'est de le montrer DANS l'app, et c'est la seule règle à ne jamais franchir.

---

## Ce que tu dois faire dans App Store Connect

### 1. L'accord « Paid Applications » et les coordonnées bancaires

Sans lui, aucun achat intégré ne fonctionne, pas même en test. Accueil → **Business** →
Agreements : l'accord *Paid Applications* doit être **Active**. Il faut aussi les informations
fiscales et bancaires d'Elkana Group.

Si tu n'as jamais rien vendu sur l'App Store, c'est probablement à faire. C'est le premier
blocage, et il n'y a rien à tester avant.

### 2. Le programme Small Business (les 15 % au lieu de 30 %)

C'est ce qui fait passer la commission de 30 % à 15 %. Ce n'est **pas** automatique : il faut
s'y inscrire. developer.apple.com → App Store Small Business Program. Condition : moins d'un
million de dollars de revenus App Store sur l'année, donc largement.

Si tu ne t'inscris pas, Apple prend 30 %, soit 11,97 € sur un Pass à 39,90 €.

### 3. Les deux produits consommables

App Store Connect → ton app → **Monetization** → In-App Purchases → créer, type **Consumable**
(consommable, pas non-consommable : une famille peut racheter un Pass la saison suivante, ou pour
un second enfant).

| Identifiant produit (exactement ceci) | Prix à choisir | Nom de référence |
|---|---|---|
| `pass_photo_19_99` | 19,99 € | Pass Photo — SF Villemomble |
| `pass_photo_39_99` | 39,99 € | Pass Photo — RCP Fontainebleau |

**L'identifiant doit être copié au caractère près** : la base le compare tel quel, et un produit
dont l'identifiant ne correspond pas fait refuser l'achat côté serveur.

**Sur les prix.** Villemomble affiche 19,90 € et Fontainebleau 39,90 €, mais Apple impose ses
propres paliers et 19,90 n'en est pas un. L'app affiche donc toujours le prix que StoreKit lui
donne, jamais celui du club, et la comptabilité enregistre le montant réellement débité par
Apple. Les 9 centimes d'écart sont normaux et voulus : mieux vaut 9 centimes d'écart entre deux
canaux qu'un prix affiché différent de celui prélevé.

Chaque produit veut aussi une **capture d'écran de revue** et une description. La capture : l'écran
d'une galerie avec le bouton « Débloquer mon Pass Photo ».

### 4. La clé d'API App Store Connect

C'est ce qui permet au serveur de demander à Apple si un achat est vrai. Sans elle, tous les
achats sont refusés.

App Store Connect → **Users and Access** → onglet **Integrations** → **App Store Connect API** →
clé avec le rôle **Admin** (ou une clé In-App Purchase dédiée si tu préfères la restreindre).

Note les trois choses avant de quitter la page :
- **Key ID** (dix caractères)
- **Issuer ID** (un UUID, affiché en haut de la page)
- le fichier **`.p8`**, téléchargeable **une seule fois**

Envoie-moi les trois, je pose les secrets côté Supabase. Ou fais-le toi :

```
APPLE_ASC_KEY_ID       = le Key ID
APPLE_ASC_ISSUER_ID    = l'Issuer ID
APPLE_ASC_PRIVATE_KEY  = tout le contenu du .p8, lignes BEGIN et END comprises
APPLE_BUNDLE_ID        = fr.sportvision.app   ← déjà posé
```

### 5. Un compte de test sandbox

App Store Connect → Users and Access → **Sandbox** → Test Accounts. Une adresse e-mail qui n'a
jamais servi à un compte Apple. C'est avec ça qu'on teste un achat réel sans être débité.

---

## Ce que tu dois faire dans Google Play Console

### 1. Le compte de développeur et la fiche de l'app

L'app n'est pas encore sur Play. Il faut créer la fiche, envoyer l'AAB
(`build/SportVision.aab`, versionCode 2) au moins sur une piste de test interne : **les produits
in-app ne sont configurables qu'une fois qu'un AAB déclarant la facturation a été envoyé.**
C'est déjà le cas du nôtre, la permission `com.android.vending.BILLING` y est.

### 2. Les deux produits in-app

Play Console → ton app → **Monétisation** → Produits → **Produits in-app** → créer.

| ID du produit (exactement ceci) | Prix |
|---|---|
| `pass_photo_19_90` | 19,90 € |
| `pass_photo_39_90` | 39,90 € |

Google n'impose aucun palier : mets le prix exact du club. C'est pour ça que les identifiants
portent 19,90 et non 19,99 comme côté Apple.

Chaque produit doit être **activé**, sinon l'app ne le voit pas et n'affiche aucun bouton.

### 3. Le compte de service, pour que le serveur puisse interroger Google

C'est l'équivalent de la clé d'API Apple, et sans lui tous les achats Android sont refusés.

1. Play Console → **Configuration** → **Accès à l'API** → lier un projet Google Cloud.
2. Dans Google Cloud → IAM → **Comptes de service** → créer un compte de service → créer une
   **clé JSON** (téléchargeable une seule fois).
3. Retour dans Play Console → Accès à l'API → donner à ce compte de service l'autorisation
   **« Voir les données financières »** et **« Gérer les commandes et les abonnements »** sur
   l'application.

Puis envoie-moi le fichier JSON, je pose le secret. Ou fais-le toi :

```
GOOGLE_PLAY_SERVICE_ACCOUNT = tout le contenu du fichier JSON, tel quel
```

Attention : l'autorisation met parfois **jusqu'à 24 h** à se propager côté Google. Un refus
d'achat le premier jour ne veut pas forcément dire que la configuration est fausse.

### 4. Un compte de test

Play Console → Configuration → **Test de licence** : ajoute ton adresse Google. Les achats faits
depuis ce compte ne sont pas débités, et notre serveur les reconnaît comme des achats de test.

---

## Ce qui est déjà fait

- `media_activer_commande` (v274) : les trois chemins ouvrent le même accès, par le même code.
  Testé sur les deux vrais produits, rejeu compris — `tests/trois-chemins-un-seul-acces.test.sql`.
- `iap-valider` : UNE fonction pour les deux magasins, déployée, protégée par JWT, refuse
  correctement sans session. Elle remplace `apple-iap-valider`, supprimée : deux fonctions qui
  écrivent des droits payants auraient fini par diverger pendant qu'une correction n'irait que
  d'un côté.
- `media_pass_disponible` (v275, étendue en v279) : ce que l'app a le droit de savoir, pour les
  deux magasins, cloisonné au joueur et à son parent confirmé. Vérifié : un autre compte est refusé.
- `media_joueurs_pour_acces` (v276) + onglet « Accès payés au club » dans l'OS : en production,
  vérifié dans le fichier servi.
- L'app : `expo-iap` intégré, un seul bouton d'achat pour les deux plateformes, BILLING déclaré
  côté Android, OpenIAP 3.5.2 lié.

## Ce qui reste, dans l'ordre

**Apple**
1. Accord Paid Applications + banque (bloquant, rien ne marche avant).
2. Small Business Program (sinon 30 % au lieu de 15 %).
3. Les deux consommables `pass_photo_19_99` / `pass_photo_39_99`.
4. La clé d'API → les trois secrets.
5. Un compte sandbox, et je teste un achat de bout en bout.
6. Soumettre le build avec les produits.

**Google**
1. Créer la fiche et envoyer l'AAB sur une piste de test (bloquant : pas de produits avant).
2. Les deux produits `pass_photo_19_90` / `pass_photo_39_90`, activés.
3. Le compte de service → le secret `GOOGLE_PLAY_SERVICE_ACCOUNT`.
4. Un compte de test de licence, et je teste un achat de bout en bout.

Les deux pistes sont indépendantes : tu peux avancer sur l'une sans l'autre.

## Un point d'attention pour la revue Apple

Le testeur Apple va essayer d'acheter. Pour qu'il puisse voir le bouton, le compte de démo que tu
lui donnes doit avoir **une galerie verrouillée avec des photos où l'enfant est reconnu**. Sans
ça, il n'y a rien à débloquer, il ne verra aucun bouton, et il refusera en disant qu'il n'a pas pu
tester l'achat.

Tu m'as dit de ne créer aucune galerie et de les faire toi-même, donc je n'y touche pas. Mais
celle-là est nécessaire avant de soumettre.
