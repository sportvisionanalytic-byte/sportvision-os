# Fiche Google Play — SportVision

Tout ce qu'il faut coller dans la Play Console, prêt à l'emploi. Les points marqués
**décision** attendent un choix de Fouka.

Le fichier à téléverser : `app-release.aab` (71 Mo), signé avec la clé de publication rangée
dans `~/Documents/SportVision-Cles/`. **Cette clé doit être sauvegardée ailleurs** : sans elle,
plus aucune mise à jour n'est possible, jamais.

---

## 1. Fiche du magasin

| Champ | Valeur |
|---|---|
| Nom de l'application (30 max) | **SportVision** |
| Description courte (80 max) | **Le calendrier, les résultats et les photos de votre club de football.** (69) |
| Catégorie | Sports |
| Tags | Football, Photo, Sport amateur |
| E-mail de contact | contact@sportvision-an.fr |
| Site web | https://sportvision-an.fr |
| Politique de confidentialité | https://sportvision-an.fr/confidentialite |
| Suppression de compte | https://sportvision-an.fr/suppression-compte |

### Description complète

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

---

## 2. Éléments graphiques (dossier `visuels/`)

| Élément | Fichier | Format exigé |
|---|---|---|
| Icône | `icone-512.png` | 512 × 512, PNG, sans transparence ✔ |
| Bannière | `banniere-1024x500.png` | 1024 × 500 ✔ |
| Captures téléphone | `captures/01` à `04` | 1080 × 1920, quatre captures (deux minimum) ✔ |

Aucune capture tablette n'est fournie : l'application ne déclare pas la compatibilité
tablette, exactement comme sur l'App Store.

---

## 3. Sécurité des données (l'équivalent Google du questionnaire Apple)

**Collectez-vous ou partagez-vous des données ?** Oui, collectées. **Jamais partagées.**

| Type | Collecté | Partagé | Obligatoire | Finalité |
|---|---|---|---|---|
| Adresse e-mail | Oui | Non | Oui | Fonctionnalité de l'app, gestion du compte |
| Nom | Oui | Non | Oui | Fonctionnalité de l'app |
| Date de naissance (Autres) | Oui | Non | Oui | Fonctionnalité de l'app |
| Photos | Oui | Non | Non | Fonctionnalité de l'app |
| Identifiants utilisateur | Oui | Non | Oui | Fonctionnalité de l'app |

Questions de sécurité :

- **Données chiffrées en transit ?** Oui (HTTPS partout).
- **L'utilisateur peut-il demander la suppression de ses données ?** Oui, dans
  l'application (Profil → Mon compte → Supprimer mon compte) et par la page
  https://sportvision-an.fr/suppression-compte
- **Publicité ou analyse comportementale ?** Non, aucune.
- **Données collectées pour du suivi entre applications ?** Non.

---

## 4. Classification du contenu (questionnaire IARC)

Catégorie : **Application (hors jeu)**. Réponses : **Non** à toutes les questions de
violence, sexe, drogue, jeu d'argent, langage grossier, achats, localisation partagée,
contenu généré par les utilisateurs.

Précision à donner telle quelle si le formulaire le permet : *les photographies sont
produites et publiées par SportVision, aucun utilisateur ne peut déposer de contenu.*

Classification attendue : **PEGI 3 / Tout public**.

---

## 5. Public cible — **décision**

Google demande les tranches d'âge visées. Deux options, et elles n'engagent pas la même
chose :

- **13 ans et plus (recommandé).** L'application s'adresse aux familles : ce sont les
  parents et les joueurs adolescents qui ouvrent un compte. Un enfant de U8 n'a pas de
  compte, c'est son parent qui suit ses photos. Cette réponse évite le programme
  « Familles » de Google et ses contraintes lourdes.
- **Moins de 13 ans.** Déclencherait la politique Familles : contrôles supplémentaires,
  règles sur la publicité (qu'on n'a pas), et examen renforcé.

À la question « votre application attire-t-elle les enfants ? » : **non**, il n'y a ni
personnage, ni jeu, ni contenu conçu pour les enfants.

---

## 6. Accès à l'application (comptes de test pour l'examinateur)

```
Espace joueur et parent
  demo.u18.villemomble@example.invalid / DemoSportVision2026!

Espace parent
  demo.parent.villemomble@example.invalid / DemoSportVision2026!

Espace club (facultatif)
  demo.coach.villemomble@example.invalid / DemoSportVision2026!
```

Instructions à coller : *L'application demande une connexion. Utilisez le premier compte
pour l'espace joueur, qui constitue l'essentiel de l'application. Un lien discret sur
l'écran d'accueil donne accès aux espaces réservés aux clubs partenaires et à nos équipes
de production.*

---

## 7. Déclarations diverses

| Question | Réponse |
|---|---|
| Publicités dans l'application | Non |
| Achats intégrés | Non |
| Application financière | Non |
| Application de santé | Non |
| Application gouvernementale | Non |
| Contenu généré par les utilisateurs | Non |
| Application COVID / traçage | Non |

---

## 8. Ce qui reste à faire, dans l'ordre

1. **Fouka** — terminer la vérification du compte développeur (identité, et association du
   site déjà approuvée dans Search Console).
2. **Fouka** — créer l'application dans la Play Console, nom **SportVision**, identifiant
   `fr.sportvision.app`, gratuite, français.
3. **Claude** — téléverser `app-release.aab` sur un canal de test interne.
4. **Fouka** — coller les textes ci-dessus, déposer les visuels, remplir sécurité des
   données, classification et public cible.
5. **Les deux** — test interne avec quelques familles, puis production.

> Rappel : si tu t'es inscrit avec un compte **personnel** et non une organisation, Google
> impose de tester avec douze personnes pendant quatorze jours avant la publication. Avec un
> compte d'organisation, cette règle ne s'applique pas. Vérifie sous quel statut tu es
> inscrit : ça change ton calendrier de deux semaines.
