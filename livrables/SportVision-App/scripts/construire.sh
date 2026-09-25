#!/usr/bin/env bash
# Construire l'application pour les deux stores, d'une seule commande.
#
# POURQUOI CE SCRIPT EXISTE. Le 25/09/2026, les deux builds ont echoue coup sur coup, et aucun
# des deux echecs ne venait du code :
#
#   iOS       « Signing for "SportVision" requires a development team ». L'identifiant d'equipe
#             vivait dans ios/SportVision.xcodeproj, qui est genere par `expo prebuild` et donc
#             ignore par Git. Un `prebuild --clean` l'efface, et le reglage disparait sans trace.
#             On le passe donc en ligne de commande : il survit a tous les prebuild.
#
#   Android   « Unable to locate a Java Runtime ». openjdk@17 est installe par Homebrew mais pas
#             lie, il n'est donc pas dans le PATH. Gradle ne le trouve pas tout seul.
#
# Les deux reglages sont ici, ecrits une fois. C'est tout l'objet du fichier : le prochain build
# ne redecouvre pas ce que celui-ci a coute.
#
# USAGE
#   bash scripts/construire.sh            les deux plateformes
#   bash scripts/construire.sh ios        l'archive iOS seule
#   bash scripts/construire.sh android    l'AAB seul
#
# AVANT DE CONSTRUIRE, penser au numero de build dans app.json :
#   expo.ios.buildNumber    doit etre superieur a celui deja depose sur App Store Connect
#   expo.android.versionCode doit etre superieur a celui deja depose sur Google Play
# Un numero deja pris est refuse au depot, apres le build, donc pour rien.
set -euo pipefail

EQUIPE_APPLE="H2J6ZBKXQD"                    # Elkana Group, le meme que le profil de distribution
JDK="/opt/homebrew/opt/openjdk@17"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SORTIE="$RACINE/build"
cible="${1:-tout}"

cd "$RACINE"
mkdir -p "$SORTIE"

# `prebuild` regenere ios/ et android/ depuis app.json, et efface au passage
# android/local.properties, que Gradle exige pour trouver le SDK Android. On le remet.
preparer() {
  echo "▸ Regeneration des projets natifs depuis app.json"
  npx expo prebuild --clean --no-install
  printf 'sdk.dir=%s\n' "${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}" \
    > android/local.properties
  (cd ios && pod install >/dev/null)
}

construire_ios() {
  echo "▸ iOS : archive (build $(plutil -extract expo.ios.buildNumber raw app.json))"
  xcodebuild -workspace ios/SportVision.xcworkspace -scheme SportVision \
    -configuration Release -destination 'generic/platform=iOS' \
    -archivePath "$SORTIE/SportVision.xcarchive" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$EQUIPE_APPLE" archive
  echo "  archive : $SORTIE/SportVision.xcarchive"
  echo "  la deposer avec Xcode › Organizer, ou : xcodebuild -exportArchive"
}

construire_android() {
  [ -d "$JDK" ] || { echo "JDK 17 absent. Installer : brew install openjdk@17" >&2; exit 1; }
  echo "▸ Android : bundle release (versionCode $(plutil -extract expo.android.versionCode raw app.json))"
  cd android
  JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH" ./gradlew bundleRelease
  cd ..
  cp android/app/build/outputs/bundle/release/app-release.aab "$SORTIE/SportVision.aab"
  echo "  bundle : $SORTIE/SportVision.aab"
}

preparer
case "$cible" in
  ios)     construire_ios ;;
  android) construire_android ;;
  tout)    construire_ios; construire_android ;;
  *)       echo "Cible inconnue : $cible (attendu : ios, android, ou rien)" >&2; exit 1 ;;
esac
echo "▸ Termine."
