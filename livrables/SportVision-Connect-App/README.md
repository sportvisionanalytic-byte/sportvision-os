# SportVision Connect — emballage Capacitor (iOS + Android)

Ce dossier ne contient **aucun code applicatif**. C'est uniquement
l'emballage natif (Capacitor) qui charge le **vrai site déployé**,
`https://connect.sportvision-an.fr` (`capacitor.config.json` → `server.url`)
— c'est-à-dire `livrables/SportVision-Connect/app-connect/` (Next.js), tel
qu'il tourne réellement en production, avec toujours la dernière version
déployée. Aucun `npm run sync` n'est nécessaire après une évolution
d'`app-connect` : l'app native charge le site en direct au démarrage, comme
un navigateur, elle ne contient jamais de copie locale du code applicatif.

**Correctif du 21/08/2026 (INC-043)** : ce dossier pointait auparavant
(`webDir`) vers `livrables/SportVision-Connect/app/`, une ancienne version
"vanilla" (HTML/JS multi-fichiers) figée depuis le 15/08 — antérieure au
tunnel de signup unifié, à l'espace particulier complet, aux cotisations
espèces et à la messagerie sécurisée. `app-connect` (Next.js, SSR) ne peut
de toute façon pas être copié tel quel dans un `webDir` statique — il a
besoin d'un vrai serveur Next.js (ce que fournit déjà le déploiement
Netlify réel). Passer par `server.url` résout aussi, en même temps, le
point ci-dessous sur `window.location.origin` : la page tourne désormais
à la vraie origine `https://connect.sportvision-an.fr`, plus jamais
`capacitor://localhost`.
`www/index.html` n'est qu'un repli local minimal, affiché uniquement si la
toute première navigation vers le site réel échoue (pas de réseau) — pas
du code applicatif, ne pas y ajouter de logique.

## Prérequis

- Node.js + npm (déjà utilisés pour tout le reste du dépôt)
- **iOS** : Xcode + CocoaPods (`pod --version`) — déjà installés sur cette
  machine. Le simulateur iOS n'était **pas encore installé** au moment où
  ce projet a été créé (Xcode → Réglages → Components → iOS 26.5) : sans
  ça, ni build ni simulateur ne fonctionnent, seule la structure du projet
  a pu être vérifiée (`xcodebuild -list`).
- **Android** : Android Studio (embarque son propre JDK — Java n'était pas
  installé séparément sur cette machine). Pas encore installé.

## Utilisation

```bash
npm install                 # une fois
npm run sync                # recopie l'app web + config dans ios/ et android/
npm run ios                 # ouvre/lance sur simulateur iOS (nécessite le simulateur installé)
npm run android              # ouvre/lance sur émulateur Android (nécessite Android Studio)
npm run assets               # régénère icônes/splash depuis assets/logo.png si le logo change
```

`npm run sync` recopie surtout la config native (`capacitor.config.json`,
icônes/splash) — le contenu web, lui, se met à jour tout seul à chaque
lancement de l'app puisqu'elle charge le site réel en direct (aucun
rebuild natif nécessaire pour un simple déploiement `app-connect`, comme
n'importe quel navigateur qui recharge une page).

## Identifiants

- `appId` : `fr.sportvision.connect`
- `appName` : SportVision Connect

## Reste à faire avant une vraie soumission sur les stores

- Compte Apple Developer Program (99$/an, vérification d'identité — à
  démarrer tôt, peut prendre plusieurs jours).
- Compte Google Play Console (25$ une fois).
- Installer le simulateur iOS (Xcode → Réglages → Components) et Android
  Studio pour pouvoir réellement tester avant de soumettre.
- URL publique de la politique de confidentialité
  (`livrables/SportVision/confidentialite.html`) à renseigner dans les
  deux stores.
- Captures d'écran, description, classification par âge (Play Store).
- ~~Point technique `window.location.origin`~~ — résolu par le passage à
  `server.url` (21/08/2026) : la page tourne à la vraie origine
  `https://connect.sportvision-an.fr`, `window.location.origin` y renvoie
  donc déjà la bonne valeur, plus besoin de plugin deep link pour ce point
  précis.
- Non testé en conditions réelles (simulateur/émulateur jamais installés
  sur cette machine, cf. Prérequis ci-dessus) : à valider dès que possible
  sur un vrai simulateur/appareil avant toute soumission — en particulier
  que le comportement offline (repli sur `www/index.html`) est correct et
  que la navigation `server.url` ne pose pas de souci CSP/CORS particulier
  en contexte natif (peu probable, la CSP d'`app-connect`, ajoutée le
  21/08, autorise déjà `'self'` et le domaine Supabase, mais jamais vérifié
  en dehors d'un navigateur desktop).
