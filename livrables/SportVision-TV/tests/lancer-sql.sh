#!/bin/bash
# Lance les tests SQL contre la base de production, et les classe correctement.
#
# POURQUOI CE SCRIPT EXISTE. 168 tests SQL vivaient dans ce dossier sans aucun moyen de les
# rejouer d'un coup : chacun se lançait à la main, donc personne ne les lançait tous. Le 26/09/2026
# j'ai cru en voir sept échouer — ils étaient tous verts. La moitié d'entre eux terminent par un
# `raise exception` DÉLIBÉRÉ, qui sert à deux choses à la fois : afficher leur rapport, et annuler
# leur décor. Un lanceur naïf compte donc un test réussi comme un échec.
#
# LA RÈGLE DE CLASSEMENT : seul le mot ROUGE (ou ÉCHEC) dans le message signale un défaut. Une
# exception qui porte VERT, RAPPORT ou un titre est une réussite. Une erreur qui n'est pas P0001
# (fonction absente, colonne absente, droit refusé) est un échec réel : le test ne s'est pas
# exécuté, et un test qui ne s'exécute pas ne prouve rien.
#
# Tout est annulé : 154 tests sont des `begin; ... rollback;`, les 14 autres des blocs DO, dont
# l'exception annule tout ce qu'ils ont écrit.
#
#   bash livrables/SportVision-TV/tests/lancer-sql.sh            # tous
#   bash livrables/SportVision-TV/tests/lancer-sql.sh galerie     # ceux dont le nom contient galerie
set -u
RACINE="$(cd "$(dirname "$0")/../../.." && pwd)"
set -a; . "$RACINE/.env"; set +a
REF=$(echo "$SUPABASE_URL" | sed -E 's#https://([a-z0-9]+)\.supabase\.co.*#\1#')
FILTRE="${1:-}"
DOSSIER="$(cd "$(dirname "$0")" && pwd)"

vert=0; rouge=0; casse=0; rapport="$(mktemp)"
for f in "$DOSSIER"/*.test.sql; do
  nom=$(basename "$f" .test.sql)
  [ -n "$FILTRE" ] && [[ "$nom" != *"$FILTRE"* ]] && continue
  python3 -c "import json,sys;print(json.dumps({'query':open(sys.argv[1]).read()}))" "$f" > /tmp/_t.json
  curl -s --max-time 120 -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
    --data @/tmp/_t.json > /tmp/_r.json
  verdict=$(python3 - "$nom" <<'PY'
import json,sys,re
nom = sys.argv[1]
try:
    d = json.loads(open('/tmp/_r.json').read(), strict=False)
except Exception:
    print("CASSE|reponse illisible"); raise SystemExit
if isinstance(d, list):
    print("VERT|"); raise SystemExit
msg = ' '.join(str(d.get('message','')).split())
code = re.search(r'ERROR:\s*([0-9A-Z]{5})', msg)
code = code.group(1) if code else '?'
if 'ROUGE' in msg.upper() or 'ECHEC' in msg.upper() or 'ÉCHEC' in msg.upper():
    print("ROUGE|" + msg[:400])
elif code == 'P0001':
    print("VERT|" + msg[:200])
else:
    print("CASSE|" + msg[:300])
PY
)
  etat=${verdict%%|*}; detail=${verdict#*|}
  case "$etat" in
    VERT)  vert=$((vert+1));  printf "  \033[32mvert \033[0m %s\n" "$nom" ;;
    ROUGE) rouge=$((rouge+1)); printf "  \033[31mROUGE\033[0m %s\n" "$nom"; printf "ROUGE %s\n      %s\n" "$nom" "$detail" >> "$rapport" ;;
    CASSE) casse=$((casse+1)); printf "  \033[33mCASSE\033[0m %s\n" "$nom"; printf "CASSE %s\n      %s\n" "$nom" "$detail" >> "$rapport" ;;
  esac
done

echo
echo "  $vert verts, $rouge rouges, $casse ne s'executent pas"
if [ -s "$rapport" ]; then echo; echo "  --- detail ---"; cat "$rapport"; fi
rm -f "$rapport"
[ "$rouge" -eq 0 ] && [ "$casse" -eq 0 ]
