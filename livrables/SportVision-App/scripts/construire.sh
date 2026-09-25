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

  # 25/09/2026 — L'EXPORT MANQUAIT, ET CA S'EST VU DE LA PIRE FACON. Le script s'arretait a
  # l'archive en renvoyant vers Xcode Organizer. Resultat : build/SportVision.ipa restait celui de
  # la veille, avec le meme nom, la meme taille, au meme endroit. Rien ne distinguait l'ancien du
  # neuf a part l'horodatage. Deposer le mauvais fichier n'aurait produit aucune erreur : juste une
  # revue Apple sur du code qui n'est plus le notre.
  #
  # L'IPA est donc produit ici, et l'ancien est efface AVANT l'export : mieux vaut pas d'IPA du
  # tout qu'un IPA perime qui a l'air bon.
  echo "▸ iOS : export de l'IPA"
  rm -f "$SORTIE/SportVision.ipa"
  local opts="$SORTIE/ExportOptions.plist"
  cat > "$opts" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$EQUIPE_APPLE</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict></plist>
PLIST
  rm -rf "$SORTIE/export"
  xcodebuild -exportArchive -archivePath "$SORTIE/SportVision.xcarchive" \
    -exportOptionsPlist "$opts" -exportPath "$SORTIE/export" -allowProvisioningUpdates
  mv "$SORTIE/export/SportVision.ipa" "$SORTIE/SportVision.ipa"

  # On relit le numero de build DANS l'IPA, au lieu de faire confiance a app.json : c'est le seul
  # controle qui distingue un export reussi d'un ancien fichier laisse en place.
  local attendu depose
  attendu="$(plutil -extract expo.ios.buildNumber raw app.json)"
  depose="$(unzip -p "$SORTIE/SportVision.ipa" 'Payload/*.app/Info.plist' | plutil -extract CFBundleVersion raw -)"
  if [ "$attendu" != "$depose" ]; then
    echo "  ERREUR : l'IPA porte le build $depose, or app.json annonce $attendu." >&2
    exit 1
  fi
  echo "  IPA : $SORTIE/SportVision.ipa (build $depose)"
}

construire_android() {
  [ -d "$JDK" ] || { echo "JDK 17 absent. Installer : brew install openjdk@17" >&2; exit 1; }
  # La cle de depot. Sans elle, Gradle repartirait sur la cle de DEBOGAGE du modele Expo et
  # produirait un AAB que Google Play refuse — sans que le build echoue, ce qui est le piege.
  local cle="$RACINE/credentials/sportvision-upload.keystore"
  [ -f "$cle" ] || { echo "Cle de depot absente : $cle" >&2
    echo "Elle est hors de Git, a restaurer depuis la sauvegarde." >&2; exit 1; }
  local mdp
  mdp="$(grep -m1 '^ANDROID_UPLOAD_KEYSTORE_PASSWORD=' "$RACINE/../../.env" | cut -d= -f2-)"
  [ -n "$mdp" ] || { echo "ANDROID_UPLOAD_KEYSTORE_PASSWORD absent du .env de la racine." >&2; exit 1; }
  export SPORTVISION_KEYSTORE="$cle" SPORTVISION_KEYSTORE_PASSWORD="$mdp"
  echo "▸ Android : bundle release (versionCode $(plutil -extract expo.android.versionCode raw app.json))"
  cd android
  JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH" ./gradlew bundleRelease
  cd ..
  cp android/app/build/outputs/bundle/release/app-release.aab "$SORTIE/SportVision.aab"
  # On verifie la signature plutot que de la supposer : un AAB signe en debogage se construit
  # sans erreur et n'est refuse qu'au depot, apres coup.
  if unzip -l "$SORTIE/SportVision.aab" | grep -q "ANDROIDD.RSA"; then
    echo "  ERREUR : le bundle est signe avec la cle de DEBOGAGE. Google Play le refusera." >&2
    echo "  Verifier que plugins/signature-android.js est bien liste dans app.json." >&2
    exit 1
  fi
  echo "  bundle : $SORTIE/SportVision.aab (signe avec la cle de depot)"
}

preparer
case "$cible" in
  ios)     construire_ios ;;
  android) construire_android ;;
  tout)    construire_ios; construire_android ;;
  *)       echo "Cible inconnue : $cible (attendu : ios, android, ou rien)" >&2; exit 1 ;;
esac
echo "▸ Termine."
