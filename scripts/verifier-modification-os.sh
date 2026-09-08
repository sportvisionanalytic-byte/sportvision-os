#!/bin/sh
# Garde-fou sur le fichier monolithique de l'OS (36 000+ lignes).
#
# Le 08/09/2026, une substitution automatique y a efface 5 465 lignes au lieu d'une fonction :
# le motif de fin de bloc n'apparaissait que bien plus loin dans le fichier. DEMO_DATA, sbFetch
# et l'authentification etaient partis, et rien dans le script ne l'a signale.
#
# A lancer APRES toute modification automatique du fichier, AVANT tout commit. Il refuse quand la
# variation depasse ce qu'une modification volontaire produit, et il verifie que le fichier
# fonctionne encore vraiment — pas seulement qu'il compte le bon nombre de lignes.
#
#   sh scripts/verifier-modification-os.sh [seuil_lignes_supprimees]

set -e
FICHIER="livrables/SportVision-TV/SportVision-OS-Full.html"
SEUIL="${1:-400}"

STAT=$(git diff --numstat -- "$FICHIER" | head -1)
AJOUT=$(echo "$STAT" | cut -f1)
SUPPR=$(echo "$STAT" | cut -f2)
AJOUT=${AJOUT:-0}; SUPPR=${SUPPR:-0}

echo "  +$AJOUT / -$SUPPR lignes (seuil de suppression : $SEUIL)"

if [ "$SUPPR" -gt "$SEUIL" ]; then
  echo "  ARRET : $SUPPR lignes supprimees, au-dela du seuil."
  echo "  Une substitution a probablement avale plus que sa cible. Inspectez :"
  echo "    git diff -U0 -- $FICHIER | grep '^-' | grep -E '^-(const|let|function|async function)' | head -30"
  echo "  Puis, si c'est bien un accident :  git checkout -- $FICHIER"
  exit 1
fi

# Les declarations de premier niveau disparues : le signal le plus fiable d'une coupe accidentelle.
PERDUES=$(git diff -U0 -- "$FICHIER" | grep '^-' | grep -cE '^-(const|let|var|function|async function) ' || true)
GAGNEES=$(git diff -U0 -- "$FICHIER" | grep '^+' | grep -cE '^\+(const|let|var|function|async function) ' || true)
echo "  declarations de premier niveau : -$PERDUES / +$GAGNEES"
if [ "$PERDUES" -gt $((GAGNEES + 12)) ]; then
  echo "  ARRET : $PERDUES declarations perdues pour $GAGNEES ajoutees."
  exit 1
fi

echo "  OK — variation coherente. Lancez maintenant les suites de tests avant de committer."
