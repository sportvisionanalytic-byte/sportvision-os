# Vendre le Pass Photo sur l'App Store

Décision de Fouka, 25/09/2026 : « j'accepte qu'Apple prenne 15 %, pour que les gens puissent
payer et déverrouiller le Pass directement sur l'application ».

Tout le code est écrit, déployé et testé. Ce qui reste demande un accès à App Store Connect,
donc c'est toi.

---

## Les trois chemins, et ce qu'ils rapportent

| Chemin | Qui encaisse | Ce que tu gardes sur 39,90 € | Où c'est proposé |
|---|---|---|---|
| Dans l'app iPhone | Apple | ~33,90 € (15 % de commission) | Bouton dans la galerie |
| Lien Stripe ou QR code | toi, via Stripe | ~38,60 € (1,4 % + 0,25 €) | Connect web, Android, QR, WhatsApp du club |
| Espèces ou virement au club | toi, directement | 39,90 € | Onglet « Accès payés au club » dans l'OS |

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

## Ce qui est déjà fait

- `media_activer_commande` (v274) : les trois chemins ouvrent le même accès, par le même code.
  Testé sur les deux vrais produits, rejeu compris — `tests/trois-chemins-un-seul-acces.test.sql`.
- `apple-iap-valider` : déployée, protégée par JWT, refuse correctement sans session.
- `media_pass_disponible` (v275) : ce que l'app a le droit de savoir, cloisonné au joueur et à son
  parent confirmé. Vérifié : un autre compte est refusé.
- `media_joueurs_pour_acces` (v276) + onglet « Accès payés au club » dans l'OS : en production,
  vérifié dans le fichier servi.
- L'app : `expo-iap` intégré, build 7, BILLING déclaré côté Android, OpenIAP 3.5.2 lié.

## Ce qui reste, dans l'ordre

1. Accord Paid Applications + banque (bloquant, rien ne marche avant).
2. Small Business Program (sinon 30 % au lieu de 15 %).
3. Les deux consommables.
4. La clé d'API → les trois secrets.
5. Un compte sandbox, et je teste un achat de bout en bout.
6. Soumettre le build 7 avec les produits.

## Un point d'attention pour la revue Apple

Le testeur Apple va essayer d'acheter. Pour qu'il puisse voir le bouton, le compte de démo que tu
lui donnes doit avoir **une galerie verrouillée avec des photos où l'enfant est reconnu**. Sans
ça, il n'y a rien à débloquer, il ne verra aucun bouton, et il refusera en disant qu'il n'a pas pu
tester l'achat.

Tu m'as dit de ne créer aucune galerie et de les faire toi-même, donc je n'y touche pas. Mais
celle-là est nécessaire avant de soumettre.
