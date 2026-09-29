#!/usr/bin/env bash
# Un build DE DEVELOPPEMENT, installable par cable (28/09/2026).
#
# POURQUOI IL EXISTE. L'archive App Store ne s'installe pas directement sur un iPhone : iOS refuse
# son profil (« Attempted to install a Beta profile without the proper entitlement »). Et un build
# TestFlight, lui, ignore le compte Sandbox des Reglages Developpeur : il passe par le vrai compte
# App Store de l'appareil, dont le pays decide de la devise affichee.
#
# Fouka voulait payer avec son compte sandbox francais et voir des euros pendant ses tests. C'est
# exactement ce qu'un build de developpement permet, et lui seul.
#
# CE QU'IL NE REMPLACE PAS : la soumission. Ce build ne part jamais chez Apple. Pour livrer, c'est
# toujours `construire.sh ios` puis `envoyer-ipa-app-store.mjs`.
#
#   bash scripts/construire-dev.sh            construit et installe sur l'appareil branche
set -euo pipefail

EQUIPE_APPLE="H2J6ZBKXQD"
CLE_ID="M3MM5D8353"
ISSUER="299e1e5e-6b69-4964-bf18-b3d9a83ee98a"
CLE="$HOME/Documents/AuthKey_${CLE_ID}.p8"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SORTIE="$RACINE/build/dev"
cd "$RACINE"

# ON DEMANDE A XCODE, PAS A libimobiledevice. `idevice_id` cesse de repondre des que l'appareil est
# verrouille ou que le lien de confiance expire — et il repond alors par du vide, sans erreur, ce
# qui se lit comme « aucun iPhone branche » alors qu'il est la. `devicectl` voit l'appareil dans
# les deux cas, et c'est lui que xcodebuild utilisera de toute facon.
#
# ET ON CHOISIT CELUI QUI PEUT RECEVOIR L'APP (29/09/2026). Deux iPhone branches, on prenait le
# premier de la liste : xcodebuild a tourne plusieurs minutes pour finir sur « Developer Mode
# disabled » alors que l'AUTRE telephone, branche lui aussi, l'avait active. On filtre donc sur le
# mode developpeur, et on ne dit « aucun appareil » que si aucun ne convient.
#
# UDID en argument pour trancher soi-meme :  bash scripts/construire-dev.sh [UDID]
CHOISI="${1:-}"
xcrun devicectl list devices --json-output /tmp/sv-devices.json >/dev/null 2>&1 || true
LECTURE="$(python3 - "$CHOISI" <<'PYFIN'
import json, sys
vise = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    d = json.load(open("/tmp/sv-devices.json"))
except Exception:
    print("|||"); raise SystemExit
branches, prets = [], []
for x in d.get("result", {}).get("devices", []):
    if x.get("connectionProperties", {}).get("tunnelState") != "connected":
        continue
    nom = x.get("deviceProperties", {}).get("name", "?")
    udid = x.get("hardwareProperties", {}).get("udid", "")
    mode = x.get("deviceProperties", {}).get("developerModeStatus", "")
    branches.append(nom)
    if mode == "enabled":
        prets.append((nom, udid))
if vise:
    prets = [p for p in prets if p[1] == vise] or prets
print("|".join([prets[0][1] if prets else "", prets[0][0] if prets else "", ", ".join(branches)]))
PYFIN
)"
UDID="$(printf '%s' "$LECTURE" | cut -d'|' -f1)"
NOM="$(printf '%s' "$LECTURE" | cut -d'|' -f2)"
BRANCHES="$(printf '%s' "$LECTURE" | cut -d'|' -f3)"
if [ -z "$UDID" ]; then
  if [ -n "$BRANCHES" ]; then
    echo "Aucun iPhone branche n'a le mode developpeur actif ($BRANCHES)."
    echo "Sur le telephone : Reglages > Confidentialite et securite > Mode developpeur."
  else
    echo "Aucun iPhone connecte. Debranche et rebranche, et deverrouille l'ecran."
  fi
  exit 1
fi
echo "▸ Appareil : $NOM ($UDID)"

# `-allowProvisioningUpdates` avec la cle d'API enregistre l'appareil et fabrique le profil de
# developpement tout seul. Sans la cle, Xcode demande un compte Apple interactif — et sa session
# expire regulierement, ce qui fait echouer le build sans rapport avec le code.
xcodebuild -workspace ios/SportVision.xcworkspace -scheme SportVision \
  -configuration Release -destination "id=$UDID" -derivedDataPath "$SORTIE" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$CLE" -authenticationKeyID "$CLE_ID" -authenticationKeyIssuerID "$ISSUER" \
  DEVELOPMENT_TEAM="$EQUIPE_APPLE" CODE_SIGN_STYLE=Automatic \
  build

APP="$(find "$SORTIE/Build/Products" -name "SportVision.app" -maxdepth 3 | head -1)"
[ -n "$APP" ] || { echo "Application introuvable dans $SORTIE"; exit 1; }
echo "▸ Installation de $APP"
xcrun devicectl device install app --device "$UDID" "$APP"
echo "▸ Termine. Cette version utilise le compte Sandbox des Reglages Developpeur."
