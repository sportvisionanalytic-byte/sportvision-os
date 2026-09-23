# Bienvenue dans le dépôt SportVision

Ce fichier est écrit pour quelqu'un qui arrive et qui va toucher au code sans connaître l'histoire
du projet. Lisez-le en entier avant votre première modification : il contient trois ou quatre
règles dont le non-respect coupe des paiements ou ferme l'accès à de vrais clubs.

SportVision est **en production, avec de vrais clubs et de vrais paiements**. Ce n'est pas un
projet d'étude.

---

## 1. Ce que contient le dépôt

| Dossier | Ce que c'est | En ligne |
|---|---|---|
| `livrables/SportVision/` | Le site vitrine public, HTML et CSS écrits à la main | sportvision-an.fr |
| `livrables/SportVision-Connect/app-connect/` | **Connect** : l'espace personnel des joueurs, parents et particuliers (Next.js) | connect.sportvision-an.fr |
| `livrables/SportVision-Connect/app-next/` | **Club+** : l'espace de travail des clubs, coachs, présidents (Next.js) | clubplus.sportvision-an.fr |
| `livrables/SportVision-TV/` | L'**OS** SportVision (un seul fichier HTML), les migrations de base, les fonctions serveur et tous les tests | bc6m3cgdz.sportvision-an.fr |
| `livrables/SportVision-App/` | L'**application mobile** iOS et Android (Expo / React Native) | en relecture chez Apple |
| `livrables/SportVision-Connect-App/` | ⛔ **Archivé.** Ancien emballage Capacitor, jamais publié. Une correction faite ici ne sortira sur aucun téléphone. | |
| `livrables/SportVision-Review-Hub/` | L'environnement de relecture | |
| `context/` | L'histoire du projet, les décisions prises et pourquoi | |

Le cœur de tout, c'est **Supabase** : une base PostgreSQL, ses règles d'accès par ligne (RLS) et
une cinquantaine de fonctions serveur. Les quatre applications ci-dessus sont quatre façons
d'ouvrir la même base. Une règle changée en base change les quatre d'un coup.

---

## 2. Les règles non négociables

Elles viennent toutes d'un incident réel. Ce ne sont pas des préférences.

### 2.1 Ne jamais déployer une fonction serveur à la main

```bash
# La seule façon correcte
bash livrables/SportVision-TV/scripts/deployer-fonction.sh <nom-de-la-fonction>

# Puis, systématiquement
bash livrables/SportVision-TV/tests/fonctions-verification-jwt.test.sh
```

**Jamais `supabase functions deploy` directement.** Huit fonctions tournent volontairement sans
vérification de jeton, dont `stripe-webhook`. Un déploiement nu la réactive, et **tous les
paiements s'arrêtent en silence** : Stripe appelle, la fonction refuse, personne ne le voit avant
qu'un client se plaigne.

Ne créez jamais de `supabase/config.toml` pour contourner : un envoi de configuration écraserait
les réglages d'authentification de la production.

### 2.2 Ne jamais écrire en base sans test rouge avant, vert après

Toute modification de la base passe par un fichier de migration daté dans
`livrables/SportVision-TV/` et par un test dans `livrables/SportVision-TV/tests/`. On écrit le
test **d'abord**, on vérifie qu'il échoue, on applique la migration, on vérifie qu'il passe. Un
test qui n'a jamais échoué ne prouve rien.

### 2.3 Aucun prix, aucun bouton d'achat dans l'application mobile

L'App Store interdit de vendre du contenu numérique hors de son système de paiement. L'application
peut dire qu'une galerie s'ouvre avec le Pass Photo ; elle ne peut ni afficher un prix, ni proposer
d'acheter, ni renvoyer vers une page de paiement. **C'est un motif de refus, pas un avis
esthétique.**

### 2.4 Les données de test ne se mélangent jamais aux vraies

Adresses en `@example.invalid`, noms préfixés `ZZ`, et tout est annulé à la fin du test
(`begin; … rollback;`). Aucun e-mail ne doit partir vers une vraie personne : le projet est
plafonné en envois, et chaque rebond abîme la réputation du domaine.

### 2.5 Gel fonctionnel

Depuis le 10 septembre 2026, seuls les correctifs P0 et P1 et les retours des premiers clubs sont
acceptés. Pas de nouvelle fonctionnalité, pas de refactorisation de confort, pas de changement de
règle métier sans demande explicite de Fouka. Voir
`livrables/SportVision-TV/PRODUCTION-MULTI-CLUBS-V1.md`.

---

## 3. Comment lancer chaque chose

Il faut Node 20 ou plus. Les clés ne sont pas dans le dépôt : demandez-les à Fouka et rangez-les
dans les fichiers `.env` locaux, qui ne sont jamais versionnés (`.env.example` montre les noms
attendus).

```bash
# Connect
cd livrables/SportVision-Connect/app-connect && npm install && npm run dev

# Club+
cd livrables/SportVision-Connect/app-next && npm install && npm run dev

# Application mobile (nécessite Xcode pour iOS)
cd livrables/SportVision-App && npm install && npx expo run:ios

# Le site vitrine et l'OS sont du HTML : ouvrez le fichier, ou servez le dossier.
```

Avant toute proposition de fusion :

```bash
npm run typecheck   # dans le dossier de l'application touchée
npm run lint
```

---

## 4. Comment on travaille ensemble

- **Une branche par sujet**, jamais de poussée directe sur `main`. Une demande de fusion,
  relue par Fouka, puis fusionnée.
- **Un message de commit explique le pourquoi**, pas le quoi. Le quoi est déjà dans le diff.
  Regardez l'historique : c'est le ton attendu.
- **Les commentaires du code sont en français** et expliquent les décisions, pas la syntaxe.
  Quand une ligne existe à cause d'un incident, le commentaire le dit et donne la date.
- **Pas de tirets longs** dans les textes destinés à l'utilisateur.
- **Jamais de faux succès** : aucun écran n'affiche « enregistré » si la ligne n'a pas changé.
  PostgREST renvoie une liste vide sans erreur quand une règle d'accès bloque une écriture ;
  il faut vérifier le résultat, pas l'absence d'erreur.

### Ce sur quoi vous pouvez avancer librement

Interfaces et styles : `app/`, `src/ui/`, `src/theme/` de l'application mobile, les composants et
les pages de Connect et Club+, le site vitrine.

### Ce qui demande une validation avant d'y toucher

`src/lib/` (les accès à la base et les droits), les migrations, les fonctions serveur, les règles
d'accès par ligne, tout ce qui touche aux paiements, aux invitations ou aux comptes. Ces parties
ont été auditées ; une modification bien intentionnée y a déjà ouvert des accès non prévus.

---

## 5. Le vocabulaire, pour éviter un malentendu coûteux

Il y a **quatre** rôles différents que l'on appelle parfois « admin ». Ne jamais écrire « admin »
seul :

- **Owner Club+** : le propriétaire du compte club.
- **Président** : administre son club, mais ne possède pas le compte.
- **CM SportVision** : le chargé de mission qui opère un club pour nous.
- **Admin SportVision** : nous, en interne.

De même, « le club » dans le code peut désigner une ligne de `organizations` ou une ligne de
`clubs` selon le contexte. Les deux existent, elles ne sont pas interchangeables : les espaces
personnels lisent `organizations`, la table `clubs` est volontairement fermée en lecture.

---

## 6. Où chercher avant de poser une question

- `context/CONTEXT.md` : l'activité, les objectifs, les projets en cours.
- `context/HISTORY.md` : le journal des sessions, par date.
- `livrables/SportVision-TV/*.md` : les audits, le modèle de menaces, l'architecture de sécurité.
- L'historique Git : chaque décision importante a son message de commit, qui explique le contexte.

Bonne arrivée. En cas de doute sur une règle métier, demandez plutôt que de deviner : la plupart
des comportements surprenants de ce code sont des décisions assumées, pas des oublis.
