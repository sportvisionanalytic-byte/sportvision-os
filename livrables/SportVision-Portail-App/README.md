# SportVision — App mobile (espace client)

App native iOS/Android (via Capacitor) qui embarque **uniquement** la partie
connectée du Portail : connexion, inscription, mot de passe oublié, et une
fois connecté le tableau de bord, demandes, devis, contrats, factures,
messagerie, livrables, notifications, rendez-vous, compte et organisation.

Le site public (catalogue, configurateur, réalisations...) n'est jamais
accessible depuis l'app — c'est géré directement dans le code du Portail
(`SportVision-Portail.html`, constante `IS_APP` + `APP_ALLOWED_PUBLIC_VIEWS`),
pas ici. Ce dossier ne contient aucune logique métier dupliquée : `www/index.html`
est une copie de build du Portail, régénérée à chaque `npm run sync` — ne
l'éditez jamais à la main.

## Ce qui est déjà fait

- Projets natifs iOS (`ios/`) et Android (`android/`) générés
- Icône et écran de démarrage générés (`assets/icon.png`, `assets/splash.png`
  — un simple monogramme "SV" aux couleurs de la marque, à remplacer par un
  vrai logo quand vous en aurez un, puis relancer `npx capacitor-assets generate`)
- `capacitor.config.json` : nom "SportVision", identifiant `com.sportvision.app`

## Ce qu'il reste à faire (ne peut pas être automatisé depuis ici)

### 1. Installer les outils manquants sur ce Mac
- **Xcode** (gratuit, App Store) — seul le "Command Line Tools" est installé actuellement, insuffisant pour compiler/signer une app iOS
- **CocoaPods** : `brew install cocoapods` (ou `sudo gem install cocoapods`)
- **Android Studio** (gratuit) — inclut le SDK Android nécessaire pour builder l'app Android
- **Java (JDK 17)** : `brew install openjdk@17` (requis par Android Studio/Gradle)

### 2. Créer les comptes développeur
- **Apple Developer Program** — 99$/an, sur developer.apple.com. Apple demande une vérification d'identité qui peut prendre 24-48h.
- **Google Play Developer** — 25$ une fois, sur play.google.com/console

### 3. Builder et ouvrir les projets
Depuis ce dossier :
```bash
npm run sync          # recopie le Portail à jour + resynchronise iOS/Android
npm run open:ios       # ouvre Xcode
npm run open:android   # ouvre Android Studio
```

### 4. Dans Xcode (iOS)
1. Sélectionnez le projet "App" → onglet "Signing & Capabilities"
2. Connectez-vous avec votre Apple ID (compte développeur), sélectionnez votre équipe
3. Vérifiez le Bundle Identifier (`com.sportvision.app`)
4. Product → Archive, puis "Distribute App" → App Store Connect
5. Complétez la fiche sur [App Store Connect](https://appstoreconnect.apple.com) (captures d'écran, description, politique de confidentialité — vous pouvez utiliser l'URL de vos CGV/confidentialité du Portail) et soumettez pour validation (généralement 24-48h)

### 5. Dans Android Studio
1. Build → Generate Signed Bundle / APK → Android App Bundle
2. Créez une clé de signature (gardez-la précieusement, impossible à récupérer si perdue — les mises à jour futures en ont besoin)
3. Créez la fiche sur [Google Play Console](https://play.google.com/console), uploadez le `.aab`, complétez la fiche, soumettez

## Mettre à jour l'app après une modification du Portail

L'app ne se met pas à jour automatiquement (contrairement au site web) : toute
modification du Portail nécessite un nouveau build + une nouvelle soumission
aux stores.

```bash
npm run sync
npm run open:ios      # puis Archive → Distribute
npm run open:android  # puis Generate Signed Bundle
```
