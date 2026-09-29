#!/usr/bin/env bash
# Est-ce que la reconnaissance tourne, et fait-elle son travail ? (29/09/2026)
#
# POURQUOI CE SCRIPT EXISTE. Un service qui tourne en permanence, personne ne le regarde — jusqu'au
# jour ou il ne tourne plus, et on s'en apercoit parce qu'une famille appelle. On veut une reponse
# en trois secondes, sans ouvrir de journal ni de console.
#
#   bash livrables/SportVision-TV/scripts/etat-reconnaissance.sh
set -uo pipefail

ETIQUETTE="fr.sportvision.reconnaissance"
JOURNAL="$HOME/Library/Logs/sportvision-reconnaissance.log"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

dire() { printf '%-30s %s\n' "$1" "$2"; }

echo
echo "LE SERVICE"
if launchctl list | grep -q "$ETIQUETTE"; then
  PID="$(launchctl list | awk -v e="$ETIQUETTE" '$3==e {print $1}')"
  dire "  etat" "en marche (pid $PID)"
  dire "  depuis" "$(ps -o etime= -p "$PID" 2>/dev/null | tr -d ' ' || echo inconnu)"
else
  dire "  etat" "ARRETE — bash livrables/SportVision-TV/scripts/installer-service-reconnaissance.sh"
fi

# LA VEILLE : c'est elle qui arrete tout sans rien dire. Deux regimes, et il faut dire lequel.
#   sur secteur  : le service tient l'assertion en permanence, meme file vide
#   sur batterie : le moteur la tient LUI-MEME, seulement pendant qu'il traite une galerie, et
#                  seulement au-dessus du plancher de batterie. File vide, le Mac dort : il n'y a
#                  aucune raison de tenir un portable eveille pour interroger une file vide.
# ON LIT UNE FOIS, PUIS ON CHERCHE DANS LA VARIABLE. `commande | grep -q` ferme le tuyau des la
# premiere correspondance : la commande de gauche meurt d'un SIGPIPE, et avec `pipefail` le test
# echoue ALORS QUE LA RECHERCHE A REUSSI. Ce script annoncait « veille NON EMPECHEE » pendant que
# l'assertion etait bien la.
ASSERTIONS="$(pmset -g assertions 2>/dev/null || true)"
ALIM="$(pmset -g batt 2>/dev/null || true)"
TENUE="non"
case "$ASSERTIONS" in *caffeinate*) TENUE="oui" ;; esac
if [ "${ALIM#*AC Power}" != "$ALIM" ]; then
  dire "  alimentation" "sur secteur"
  if [ "$TENUE" = "oui" ]; then
    dire "  veille du Mac" "empechee en permanence"
  else
    dire "  veille du Mac" "NON EMPECHEE — le Mac peut s'endormir et tout s'arrete"
  fi
else
  NIVEAU="$(printf '%s' "$ALIM" | grep -o '[0-9]*%' | head -1 || true)"
  dire "  alimentation" "sur batterie (${NIVEAU:-?})"
  if [ "$TENUE" = "oui" ]; then
    dire "  veille du Mac" "empechee : une galerie est en cours de traitement"
  else
    dire "  veille du Mac" "libre — normal file vide ; sous 30 % de batterie, le moteur laisse dormir"
  fi
fi

echo
echo "CE QU'IL A FAIT"
if [ -f "$JOURNAL" ]; then
  dire "  derniere activite" "$(date -r "$JOURNAL" '+%d/%m a %Hh%M' 2>/dev/null || echo inconnue)"
  grep -v VerifyOutputSizes "$JOURNAL" 2>/dev/null | grep -E "identification|numero|visage|dossard" | tail -3 | sed 's/^/    /'
else
  dire "  journal" "aucun"
fi

echo
echo "LA FILE D'ATTENTE"
if [ -f "$RACINE/.env" ]; then
  # On lit la base par son API : la meme que l'application, jamais un acces direct.
  URL="$(grep -m1 '^SUPABASE_URL=' "$RACINE/.env" | cut -d= -f2-)"
  CLE="$(grep -m1 '^SUPABASE_SECRET_KEY=' "$RACINE/.env" | cut -d= -f2-)"
  ATTENTE="$(curl -s -I -H "apikey: $CLE" -H "Authorization: Bearer $CLE" -H "Prefer: count=exact" \
    "$URL/rest/v1/reconnaissance_a_faire?select=id&traite_le=is.null&limit=1" \
    | tr -d '\r' | awk -F/ '/content-range/ {print $2}')"
  dire "  travaux en attente" "${ATTENTE:-illisible}"
else
  dire "  base" "pas de .env a la racine"
fi
echo
