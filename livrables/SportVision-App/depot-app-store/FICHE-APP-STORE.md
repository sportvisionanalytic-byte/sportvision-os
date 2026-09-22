# Fiche App Store — SportVision

Tout ce qu'il faut coller dans App Store Connect, prêt à l'emploi. Les champs marqués
**à décider** attendent une réponse de Fouka.

---

## 1. Informations de l'app

| Champ | Valeur |
|---|---|
| Nom | **SportVision** |
| Sous-titre (30 caractères max) | **Le foot de votre club, en photo** (29) |
| Identifiant de bundle | `fr.sportvision.app` |
| SKU | `sportvision-app-1` |
| Catégorie principale | Sports |
| Catégorie secondaire | Photo et vidéo |
| Langue principale | Français |
| Prix | Gratuit |
| Droits de diffusion | Elkana Group |

## 2. URL

| Champ | Valeur |
|---|---|
| URL d'assistance | `https://sportvision-an.fr/contact` |
| URL marketing | `https://sportvision-an.fr` |
| Politique de confidentialité | `https://sportvision-an.fr/confidentialite` |

> **À vérifier avant dépôt :** la page de confidentialité doit mentionner explicitement
> l'application mobile, pas seulement le site. Apple la lit.

## 3. Description (4 000 caractères max)

```
SportVision accompagne les clubs de football amateurs en photo et en vidéo. Cette
application est celle des joueurs et de leurs parents.

VOTRE SAISON, AU MÊME ENDROIT

Le prochain match, avec l'heure, le stade et l'itinéraire. Les entraînements de la
semaine. Les résultats de votre équipe, match après match. Tout ce que votre club
publie arrive ici, sans que vous ayez à le chercher.

VOS PHOTOS, PAS CELLES DES AUTRES

Après chaque rencontre couverte par SportVision, les photos sont publiées dans la
galerie de votre équipe. Celles où vous apparaissez vous sont signalées. Vous ouvrez
la galerie, vous retrouvez vos moments, et la vidéo du match quand elle existe.

POUR LES PARENTS

Un compte parent suit un ou plusieurs enfants. Vous passez de l'un à l'autre en un
geste : son calendrier, ses résultats, ses photos.

VOTRE CLUB, DANS VOTRE POCHE

L'écusson, l'équipe, l'état de votre rattachement. Les coachs, présidents et
secrétaires y retrouvent aussi leur espace de travail.

SIMPLE, ET RESPECTUEUX

Pas de fil d'actualité, pas de publicité, pas de notification inutile. Les photos d'un
joueur ne sont visibles que par lui et par ses parents.

SportVision est une marque d'Elkana Group, société française de production audiovisuelle
sportive.
```

## 4. Nouveautés de cette version (4 000 caractères max)

```
Première version de l'application SportVision.

Votre calendrier, les résultats de votre équipe et vos photos de match, dans une
application pensée pour le bord du terrain.
```

## 5. Mots-clés (100 caractères max, séparés par des virgules)

```
foot,football,club,match,calendrier,photos,galerie,équipe,joueur,parent,amateur,résultats
```
*(88 caractères)*

## 6. Classification d'âge

Réponse à toutes les questions de contenu : **Aucun / Jamais**.

- Pas de violence, pas de contenu sexuel, pas de jeu d'argent, pas d'alcool.
- **Contenu généré par les utilisateurs : non.** Les photos sont produites et publiées par
  SportVision, aucune personne ne dépose de contenu dans l'application.
- Classification attendue : **4+**

> Si Apple demande si l'app s'adresse aux enfants : **non**, elle s'adresse aux familles.
> Ne pas cocher la catégorie « Enfants » de l'App Store, qui impose des règles bien plus
> lourdes et interdirait l'accès aux comptes.

## 7. Confidentialité — ce que collecte l'application

À déclarer dans la section « Confidentialité des données ». Trois catégories seulement.

| Donnée | Usage | Liée à l'identité | Suivi publicitaire |
|---|---|---|---|
| Adresse e-mail | Fonctionnement de l'app (compte) | Oui | Non |
| Nom et prénom | Fonctionnement de l'app (rattachement au club) | Oui | Non |
| Photos (contenu utilisateur) | Fonctionnement de l'app (galeries du club) | Oui | Non |

- **Aucun identifiant publicitaire, aucun traceur, aucune analyse comportementale.**
- Réponse à « Utilisez-vous les données pour du suivi ? » : **Non**.
- Date de naissance : collectée à l'inscription d'un joueur. À déclarer en « Autres données »,
  usage « Fonctionnement de l'app », liée à l'identité, sans suivi.

## 8. Compte de démonstration pour la relecture

```
Espace joueur et parent (celui à relire)
  Adresse : demo.u18.villemomble@example.invalid
  Mot de passe : DemoSportVision2026!

Espace parent
  Adresse : demo.parent.villemomble@example.invalid
  Mot de passe : DemoSportVision2026!

Espace club, si le relecteur souhaite l'ouvrir
  Adresse : demo.coach.villemomble@example.invalid
  Mot de passe : DemoSportVision2026!
```

> Ces comptes ouvrent les espaces d'un club réel, avec son calendrier et ses résultats.
> **À ne pas supprimer** tant que la relecture est en cours. Le troisième est fourni pour
> qu'aucun écran ne reste inaccessible au relecteur, même les espaces professionnels.

## 9. Notes pour le relecteur (à coller telles quelles)

```
Bonjour,

SportVision est une société française de production photo et vidéo pour les clubs de
football amateurs. Cette application est destinée aux joueurs licenciés et à leurs
parents. Quelques précisions pour faciliter la relecture.

1. ACCÈS
Un compte de démonstration est fourni ci-dessus. Il ouvre l'espace joueur avec le
calendrier et les résultats d'un club réel.

2. PAS D'ACHAT DANS L'APPLICATION
L'application ne vend rien et n'affiche aucun prix. Les galeries photo sont ouvertes par
un « Pass Photo » que le club propose aux familles en dehors de l'application, par ses
propres canaux. L'application se contente d'afficher les galeries déjà accessibles,
conformément à la règle 3.1.3(b) sur les services multiplateformes. Aucun bouton ni lien
ne renvoie vers un achat.

3. PHOTOGRAPHIES DE MINEURS
Les photos sont prises par nos équipes lors des matchs, sur autorisation écrite du club
et des représentants légaux, recueillie hors de l'application. Aucun utilisateur ne peut
déposer de photo : il n'y a pas de contenu généré par les utilisateurs. Les photos d'un
joueur ne sont visibles que par lui-même et par son parent dont le lien a été confirmé
par le club.

4. ESPACES PROFESSIONNELS
L'application est celle des familles : l'écran d'accueil propose l'espace joueur et
parent, entièrement natif, qui constitue l'essentiel de l'application.

Un lien discret, « Vous travaillez avec SportVision ? », révèle deux espaces réservés :
celui des clubs partenaires et celui de nos équipes de production. Ils ouvrent nos outils
professionnels internes dans une vue web, et ne s'adressent pas au grand public. Des
identifiants sont fournis ci-dessus si vous souhaitez les ouvrir.

5. SUPPRESSION DE COMPTE
Elle se fait dans l'application : Profil, puis Mon compte, puis « Supprimer mon compte ».
Deux confirmations, puis suppression définitive. Les factures éventuelles sont conservées
et anonymisées, comme la comptabilité française l'impose.

Merci de votre relecture.
```

## 10. Captures d'écran

Quatre captures au format 6,9 pouces (1320 × 2868), dans `captures/` :

1. **Accueil** — le prochain rendez-vous, les raccourcis, la dernière galerie, les résultats
2. **Mes photos** — les galeries de l'équipe, dont une verrouillée
3. **Calendrier** — à venir et terminés, avec les scores
4. **Fiche de match** — équipes, lieu, itinéraire

> Apple n'exige plus que le format 6,9 pouces : il est décliné automatiquement pour les
> autres tailles. L'app ne déclare pas la compatibilité iPad, aucune capture iPad n'est donc
> demandée.

## 11. Chiffrement

Déjà déclaré dans l'application (`ITSAppUsesNonExemptEncryption = false`). L'app n'utilise que
le chiffrement standard des communications HTTPS. Répondre **Non** à la question sur l'usage
d'algorithmes non exemptés.

---

## Ce qu'il reste à faire, dans l'ordre

1. **Fouka** — vérifier que la page de confidentialité couvre l'application mobile.
2. **Fouka** — créer la fiche dans App Store Connect avec le bundle `fr.sportvision.app`.
3. **Claude** — archiver et téléverser le build.
4. **Fouka** — coller les textes ci-dessus, déposer les captures, remplir les déclarations
   de confidentialité et de classification.
5. **Les deux** — activer TestFlight en test interne pour installer chez quelques familles
   immédiatement, puis envoyer en relecture. Les deux peuvent se faire avec le même build.
