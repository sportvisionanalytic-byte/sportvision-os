# SportVision Connect — emballage Capacitor (iOS + Android)

Ce dossier ne contient **aucun code applicatif**. C'est uniquement
l'emballage natif (Capacitor) qui charge l'app web existante,
`livrables/SportVision-Connect/app/`, restée la seule source de vérité —
`capacitor.config.json` pointe dessus (`webDir`). Toute modification faite
dans `SportVision-Connect/app/` (nouveau module, correctif, design) est
reprise automatiquement au prochain `npm run sync`, sans rien dupliquer ni
reconstruire ici.

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

Après toute modification dans `../SportVision-Connect/app/`, il suffit de
relancer `npm run sync` — pas besoin de rebuild manuel des projets natifs
pour que le contenu web change (recharger l'app suffit en dev ; un vrai
rebuild n'est nécessaire que si une dépendance/plugin natif change).

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
- Point technique non résolu dans ce scaffold : les liens de
  réinitialisation de mot de passe / auth envoyés par e-mail utilisent
  `window.location.origin`, qui vaudra une URL interne à l'app
  (`capacitor://localhost` ou `https://localhost`) plutôt que le vrai
  domaine `connect.sportvision.fr` une fois packagé en natif — à corriger
  avec le plugin Capacitor App (deep link/custom URL scheme) avant de
  tester les flux d'authentification réels dans l'app buildée.
