#!/bin/bash
# Les Edge Functions ont-elles gardé leur réglage de vérification JWT ?
#
# À lancer après TOUT déploiement de fonction. Ne crée rien, ne modifie rien : il lit l'état réel
# en production et le compare à ce qu'il doit être.
#
# ── Pourquoi ce test existe ──
# Huit fonctions tournent volontairement sans vérification JWT (voir supabase/functions/README.md).
# Un `supabase functions deploy` nu réactive cette vérification sans prévenir. Pour stripe-webhook,
# c'est la fin silencieuse de tous les paiements : Stripe reçoit un 401, réessaie, et personne ne
# voit rien avant qu'un parent se plaigne de ne pas avoir reçu ses photos.
#
# Le test surveille aussi l'autre sens : une fonction qui passerait SANS vérification alors qu'elle
# ne devrait pas s'ouvrirait à n'importe qui sur Internet.

set -uo pipefail
cd "$(dirname "$0")/.."
ENVF=../../.env
TOKEN=$(grep '^SUPABASE_MANAGEMENT_TOKEN=' "$ENVF" | cut -d= -f2-)
REF=$(grep '^SUPABASE_URL=' "$ENVF" | sed -E 's|.*//([a-z0-9]+)\..*|\1|')
SB=$(grep '^SUPABASE_URL=' "$ENVF" | cut -d= -f2-)

# La liste attendue. Toute nouvelle fonction publique s'ajoute ici ET dans le README.
ATTENDUES_SANS_JWT="clubplus-onboarding create-gallery-checkout dispatch-notifications federation-sync-matchs gallery-download gallery-download-zip stripe-webhook youtrust-webhook"

FAIL=0
ok(){ echo "OK   $1"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }

ETAT=$(curl -sS "https://api.supabase.com/v1/projects/$REF/functions" -H "Authorization: Bearer $TOKEN")
REELLES_SANS_JWT=$(echo "$ETAT" | python3 -c "import json,sys;print(' '.join(sorted(f['slug'] for f in json.load(sys.stdin) if f.get('verify_jwt') is False)))")

for F in $ATTENDUES_SANS_JWT; do
  echo " $REELLES_SANS_JWT " | grep -q " $F " \
    && ok "$F reste joignable sans jeton" \
    || ko "$F a RETROUVE la verification JWT" "redeployer avec scripts/deployer-fonction.sh apres correction manuelle (--no-verify-jwt)"
done

for F in $REELLES_SANS_JWT; do
  echo " $ATTENDUES_SANS_JWT " | grep -q " $F " \
    || ko "$F tourne SANS verification JWT alors qu'elle n'est pas dans la liste attendue" "l'ajouter a la liste et au README si c'est voulu, sinon la refermer"
done

# La preuve par l'usage : Stripe doit pouvoir atteindre son webhook. Sans signature, la fonction
# doit repondre 400 (signature refusee par le code) — un 401 voudrait dire que la plateforme la
# bloque avant meme qu'elle s'execute.
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/functions/v1/stripe-webhook" -H "Content-Type: application/json" -d '{}')
[ "$C" = "400" ] && ok "stripe-webhook repond 400 sans signature : Stripe peut l'atteindre" \
                 || ko "stripe-webhook injoignable pour Stripe" "HTTP $C (400 attendu)"

echo
[ "$FAIL" = "0" ] && echo "Tout est vert." || echo "$FAIL echec(s)."
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
