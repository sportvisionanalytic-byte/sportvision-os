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
  <!-- ADAPTATIF, ET NON « ARRIERE-PLAN » (29/09/2026). « Background » envoie le processus sur les
       coeurs lents en permanence : mesure sur la meme galerie, 110 photos en 305 s lance a la main
       contre plus de 25 minutes en service. La reconnaissance est ce qui fait vendre le Pass, elle
       ne peut pas etre quatre fois plus lente juste parce qu'elle tourne toute seule.
       « Adaptive » laisse macOS lui donner les coeurs rapides quand personne ne se sert du Mac, et
       la brider des que Fouka revient dessus. C'est exactement ce qu'on veut. -->
  <key>ProcessType</key><string>Adaptive</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$JOURNAL</string>
  <key>StandardErrorPath</key><string>$JOURNAL</string>
</dict>
</plist>
PLISTFIN

# ARRETER PUIS REDEMARRER DEMANDE D'ATTENDRE (29/09/2026). launchd rend la main avant d'avoir fini
# de decharger le service : le bootstrap qui suit immediatement echoue avec « Input/output error 5 »,
# le service reste eteint, et le script dit pourtant « installe et demarre ». On attend qu'il ait
# vraiment disparu, et on reessaie plutot que d'annoncer un succes qu'on n'a pas verifie.
launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null || true
for _ in $(seq 1 20); do
  launchctl print "gui/$(id -u)/$ETIQUETTE" >/dev/null 2>&1 || break
  sleep 0.5
done

pose=""
for _ in $(seq 1 10); do
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then pose="oui"; break; fi
  sleep 1
done
[ -n "$pose" ] || { echo "launchd a refuse de demarrer le service. Journal : $JOURNAL"; exit 1; }

# ET ON VERIFIE QU'IL TOURNE VRAIMENT : un service pose n'est pas un service vivant.
launchctl list | grep -q "$ETIQUETTE" || { echo "Le service est pose mais ne tourne pas. Journal : $JOURNAL"; exit 1; }

echo "Service installe et demarre."
echo "  ce qu'il fait  : tail -f $JOURNAL"
echo "  l'arreter      : bash scripts/installer-service-reconnaissance.sh --retirer"
