#!/bin/bash
# Lance les tests node qui n'ont besoin NI d'un navigateur NI d'une application servie localement.
#
# POURQUOI CE SCRIPT EXISTE, et pourquoi il pose TZ. 90 tests node vivaient ici sans moyen de les
# rejouer d'un coup. En les lançant à la main le 26/09/2026, deux pièges se sont présentés, tous
# deux du côté du lanceur et pas des tests :
#
#   • `timeout` n'existe pas sur macOS. Les 31 tests ont rendu le code 127 (« commande
#     introuvable ») : aucun n'avait été exécuté, et la sortie ressemblait à 31 échecs.
#   • `os-dates-locales` exige TZ=Europe/Paris et refuse de tourner autrement, à dessein : c'est le
#     fuseau des utilisateurs, et un « aujourd'hui » calculé en UTC a déjà coupé l'accès d'un CM à
#     son club entre minuit et 2 h. Le lanceur le pose pour tous.
#
# Les 59 tests qui pilotent un navigateur ne sont pas ici : ils demandent Playwright et, pour
# certains, une app servie en local. Voir tests/README.md pour leur mode d'emploi.
#
#   bash livrables/SportVision-TV/tests/lancer-node.sh            # tous
#   bash livrables/SportVision-TV/tests/lancer-node.sh galerie    # ceux dont le nom contient galerie
set -u
RACINE="$(cd "$(dirname "$0")/../../.." && pwd)"
set -a; . "$RACINE/.env"; set +a
export TZ=Europe/Paris
DOSSIER="$(cd "$(dirname "$0")" && pwd)"
FILTRE="${1:-}"

vert=0; ko=0; detail="$(mktemp)"
for f in "$DOSSIER"/*.test.mjs; do
  nom=$(basename "$f" .test.mjs)
  [ -n "$FILTRE" ] && [[ "$nom" != *"$FILTRE"* ]] && continue
  grep -q "playwright\|chromium" "$f" && continue
  sortie=$(node "$f" 2>&1); code=$?
  if [ $code -eq 0 ]; then
    vert=$((vert+1)); printf "  \033[32mvert \033[0m %s\n" "$nom"
  else
    ko=$((ko+1)); printf "  \033[31mECHEC\033[0m %s\n" "$nom"
    { echo "=== $nom (code $code)"; echo "$sortie" | tail -12; echo; } >> "$detail"
  fi
done

echo
echo "  $vert verts, $ko echecs"
if [ -s "$detail" ]; then echo; echo "  --- detail ---"; cat "$detail"; fi
rm -f "$detail"
[ "$ko" -eq 0 ]
