#!/usr/bin/env bash
# Publier une mise a jour a distance (OTA) sur le canal production.
#
# CE QUE CETTE COMMANDE FAIT, ET POURQUOI ELLE MERITE UN SCRIPT. Elle envoie du code JavaScript
# a TOUS les telephones qui ont l'application, sans passer par Apple. C'est puissant et c'est
# irreversible dans les faits : on ne rappelle pas une publication, on en publie une autre.
# Un script permet de verifier AVANT, une fois pour toutes, les trois choses qui la rendent
# silencieusement inoperante ou dangereuse.
#
#   bash scripts/publier-mise-a-jour.sh "ce que contient cette mise a jour"
#
# ── LES TROIS VERIFICATIONS, ET CE QUI ARRIVE SI ON LES OUBLIE ──────────────────────────────────
#
# 1. LA VERSION D'EXECUTION DOIT CORRESPONDRE. `runtimeVersion` est la policy `appVersion`, donc
#    « 1.0.0 ». Le build 20 soumis a Apple porte `EXUpdatesRuntimeVersion = 1.0.0` dans son
#    Expo.plist (verifie le 30/09). Si `version` change dans app.json, la mise a jour part sur une
#    autre version d'execution et les telephones l'IGNORENT SANS RIEN DIRE. C'est la panne la plus
#    couteuse ici, parce qu'elle ressemble a « mon correctif ne marche pas ».
#
# 2. AUCUN MODULE NATIF NE DOIT AVOIR CHANGE. Une mise a jour ne porte que du JavaScript. Si
#    package.json a gagne une dependance native depuis le build installe, le code appelle un module
#    qui n'existe pas dans le binaire et l'application plante au demarrage — sur tous les telephones
#    a la fois, sans possibilite de revenir en arriere autrement qu'en publiant a nouveau.
#
# 3. LE TRAVAIL DOIT ETRE COMMITE. Une publication qui ne correspond a aucun commit est
#    irretrouvable : on ne sait plus quel code tourne chez les gens.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MESSAGE="${1:-}"
if [ -z "$MESSAGE" ]; then
  echo "Dites ce que contient cette mise a jour :"
  echo "  bash scripts/publier-mise-a-jour.sh \"corrige le 31 fevrier a l'inscription\""
  exit 1
fi

echo "▸ 1. La version d'execution"
VERSION=$(python3 -c "import json;print(json.load(open('app.json'))['expo']['version'])")
echo "   app.json : $VERSION"
if [ -f build/SportVision.ipa ]; then
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  unzip -q -o build/SportVision.ipa -d "$T"
  EMBARQUEE=$(/usr/libexec/PlistBuddy -c "Print EXUpdatesRuntimeVersion" \
    "$T/Payload/SportVision.app/Expo.plist" 2>/dev/null || echo "?")
  echo "   build soumis : $EMBARQUEE"
  if [ "$VERSION" != "$EMBARQUEE" ]; then
    echo "   STOP. Les deux ne correspondent pas : les telephones ignoreraient cette mise a jour"
    echo "   en silence. Il faut un nouveau build, pas une publication."
    exit 1
  fi
else
  echo "   (pas d'archive locale a comparer — verifiez vous-meme que le build en ligne porte $VERSION)"
fi

echo "▸ 2. Les modules natifs"
if ! git diff --quiet HEAD -- package.json ios android 2>/dev/null; then
  echo "   STOP. package.json, ios/ ou android/ ont des changements non commites."
  echo "   Une mise a jour ne porte que du JavaScript : si un module natif a change, il faut un build."
  exit 1
fi
echo "   rien de natif en attente"

echo "▸ 3. Le travail est-il commite ?"
if ! git diff --quiet HEAD -- . 2>/dev/null; then
  echo "   STOP. Des changements de l'application ne sont pas commites."
  echo "   Une publication introuvable dans l'historique est du code qu'on ne peut plus identifier."
  git status --short -- . | head -10
  exit 1
fi
COMMIT=$(git rev-parse --short HEAD)
echo "   commit $COMMIT"

echo "▸ 4. TypeScript"
npx tsc --noEmit -p . >/dev/null
echo "   propre"

echo
echo "▸ Publication sur le canal « production », depuis le commit $COMMIT"
npx eas-cli@latest update --branch production --message "$MESSAGE ($COMMIT)" --non-interactive

echo
echo "▸ Publie. Ce qui se passe maintenant, et ce qu'il faut savoir :"
echo "   Le build 20 verifie, telecharge et applique DES LE PREMIER lancement (appliquerMiseAJour,"
echo "   voir src/lib/mise-a-jour.ts) : une application deja ouverte l'aura a sa prochaine ouverture,"
echo "   et un telechargement neuf depuis l'App Store l'aura tout de suite, apres un bref rechargement."
echo "   Sans ce code, expo-updates n'appliquerait qu'au lancement SUIVANT — ce qui a coute deux jours"
echo "   le 27/09."
