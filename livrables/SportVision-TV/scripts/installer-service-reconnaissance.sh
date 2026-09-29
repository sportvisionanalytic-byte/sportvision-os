#!/usr/bin/env bash
# Faire tourner la reconnaissance toute seule, en permanence (28/09/2026).
#
# POURQUOI CE SCRIPT EXISTE. Fouka : « des lors qu'il y a une photo qui pop, bam, elle retrouve ses
# photos. » Tout etait deja en place sauf un maillon : la file se remplit toute seule depuis la
# v325 — une photo de reference deposee, une galerie publiee, et le travail s'y inscrit — mais
# personne ne la vidait. C'etait fait a la main, donc quand on y pensait.
#
# CE QUE CA INSTALLE. Un service macOS (launchd) qui lance le moteur en mode boucle au demarrage de
# la session et le relance s'il s'arrete. Le moteur reste immobile tant que la file est vide : une
# requete toutes les vingt secondes, rien de plus. Des qu'un travail arrive, il le traite.
#
# QUEL MOTEUR (29/09/2026). Le service lance desormais moteur-reconnaissance/moteur.mjs, et non
# plus scripts/reconnaissance-automatique.mjs. L'ancien tournait dans un Chromium avec face-api
# (descripteur de 128 dimensions, 2017) et trouvait 9 visages sur 110 photos reelles ; le nouveau
# tourne en Node avec SCRFD et ArcFace (512 dimensions) et en trouve 283. Il repere aussi les
# photos de groupe, qui vont a toute l'equipe.
#
# CE QUE LE NOUVEAU NE FAIT PAS ENCORE, et il faut le savoir en lisant ce fichier :
#   - il ne lit pas les dossards. L'ancien croyait le faire : la v338 a montre que ses 59 releves
#     etaient des plis de maillot et des sponsors, et les a effaces. Le portage est ecrit
#     (moteur-reconnaissance/dossards.mjs) et volontairement debranche tant qu'il n'est pas prouve.
#   - il ne decrit pas les silhouettes. Reconnaitre quelqu'un de dos demande un modele de corps,
#     qui reste a ajouter.
#
# CE QUE CA NE FAIT PAS. Ca ne remplace pas la reconnaissance AU DEPOT : l'OS reconnait deja chaque
# photo pendant que l'operateur la verse, et c'est ce qui rend le resultat immediat. Attention, l'OS
# utilise encore l'ANCIEN modele dans le navigateur : les deux cohabitent sans se melanger (une
# empreinte appartient a un modele depuis la v337), mais le resultat immediat reste le moins bon
# des deux tant que l'OS n'est pas repris.
#
#   bash scripts/installer-service-reconnaissance.sh            installe et demarre
#   bash scripts/installer-service-reconnaissance.sh --retirer  arrete et desinstalle
#   tail -f ~/Library/Logs/sportvision-reconnaissance.log       voir ce qu'il fait
set -euo pipefail

ETIQUETTE="fr.sportvision.reconnaissance"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETTE.plist"
JOURNAL="$HOME/Library/Logs/sportvision-reconnaissance.log"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MOTEUR="$RACINE/livrables/SportVision-TV/moteur-reconnaissance/moteur.mjs"
MODELES="$RACINE/livrables/SportVision-TV/moteur-reconnaissance/modeles"

if [ "${1:-}" = "--retirer" ]; then
  launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Service retire. La reconnaissance ne tournera plus toute seule."
  exit 0
fi

[ -f "$MOTEUR" ] || { echo "Moteur introuvable a $MOTEUR"; exit 1; }
# Les poids ne sont pas dans Git (190 Mo) : sans eux le service demarrerait pour echouer en boucle,
# toutes les dix secondes, sans que personne le voie.
[ -f "$MODELES/detection.onnx" ] && [ -f "$MODELES/reconnaissance.onnx" ] || {
  echo "Les modeles manquent dans $MODELES."
  echo "Voir livrables/SportVision-TV/moteur-reconnaissance/LISEZMOI.md pour les recuperer."
  exit 1
}
[ -f "$RACINE/.env" ] || { echo "Il manque le .env a la racine ($RACINE)."; exit 1; }

NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "node est introuvable dans le PATH."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTFIN
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETTE</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$MOTEUR</string>
    <string>--boucle</string>
  </array>
  <key>WorkingDirectory</key><string>$RACINE</string>
  <key>RunAtLoad</key><true/>
  <!-- Il se relance s'il s'arrete : une coupure reseau ne doit pas eteindre la reconnaissance
       jusqu'au prochain redemarrage. -->
  <key>KeepAlive</key><true/>
  <!-- Dix secondes entre deux relances : sans ce delai, une erreur au demarrage ferait boucler
       launchd a pleine vitesse. -->
  <key>ThrottleInterval</key><integer>10</integer>
  <!-- En tache de fond : la reconnaissance ne doit jamais ralentir le Mac pendant qu'on s'en sert. -->
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$JOURNAL</string>
  <key>StandardErrorPath</key><string>$JOURNAL</string>
</dict>
</plist>
PLISTFIN

launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Service installe et demarre."
echo "  ce qu'il fait  : tail -f $JOURNAL"
echo "  l'arreter      : bash scripts/installer-service-reconnaissance.sh --retirer"
