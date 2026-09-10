#!/bin/bash
# Deployer une Edge Function SANS changer son reglage de verification JWT.
#
#   bash scripts/deployer-fonction.sh stripe-webhook
#   bash scripts/deployer-fonction.sh request-password-reset send-devis-email
#
# ── Pourquoi ce script existe ──
# Au 10/09/2026, huit fonctions tournent en production SANS verification JWT, et c'est voulu :
#
#   stripe-webhook, youtrust-webhook   appeles par Stripe et Youtrust, qui n'ont pas de jeton Supabase
#   create-gallery-checkout            un parent qui achete sans compte
#   gallery-download, -zip             le lien de telechargement recu par e-mail
#   dispatch-notifications             declenche par le cron
#   federation-sync-matchs             declenche par le cron
#   clubplus-onboarding
#
# Or AUCUN fichier du depot ne le memorise. `supabase functions deploy <nom>` repasse par defaut
# verify_jwt a true. Un seul redeploiement distrait de stripe-webhook, et Stripe recoit un 401 a
# chaque paiement : les commandes restent « en attente », les droits ne sont jamais crees, les
# parents paient sans rien recevoir — et rien ne sonne, puisque Stripe se contente de reessayer.
#
# Constate en redeployant douze fonctions le 10/09/2026 pour un correctif de fuseau horaire : il a
# fallu penser a --no-verify-jwt a la main pour stripe-webhook.
#
# ── Pourquoi pas un config.toml ──
# C'est la solution habituelle, mais le CLI lit aussi ce fichier pour `supabase config push`, qui
# pousse les reglages d'AUTHENTIFICATION. Un config.toml minimal, contenant seulement les fonctions,
# ferait qu'un `config push` distrait remettrait les valeurs par defaut en production : l'URL du site
# et la liste blanche des redirections, donc tous les liens d'invitation et de reinitialisation.
# Ce script ne cree aucun fichier de ce genre : il lit le reglage REEL en production, et le reproduit.

set -euo pipefail
cd "$(dirname "$0")/.."

ENVF=../../.env
TOKEN=$(grep '^SUPABASE_MANAGEMENT_TOKEN=' "$ENVF" | cut -d= -f2-)
REF=$(grep '^SUPABASE_URL=' "$ENVF" | sed -E 's|.*//([a-z0-9]+)\..*|\1|')
export SUPABASE_ACCESS_TOKEN="$TOKEN"

[ $# -ge 1 ] || { echo "Usage : $0 <fonction> [<fonction>...]"; exit 1; }

etat() {
  curl -sS "https://api.supabase.com/v1/projects/$REF/functions" -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import json,sys;d={f['slug']:f.get('verify_jwt') for f in json.load(sys.stdin)};print(d.get('$1','absente'))"
}

for F in "$@"; do
  [ -d "supabase/functions/$F" ] || { echo "KO  $F : dossier introuvable"; continue; }

  # Verification de types AVANT tout envoi. Le 10/09/2026, une seconde declaration `const admin`
  # dans clubplus-envoyer-invitation a empeche la fonction de demarrer (BOOT_ERROR) : toutes les
  # invitations par e-mail sont tombees jusqu'au retour a la version precedente. Le controle fait
  # a la main avant ce deploiement ne verifiait rien — `deno check --no-remote` s'arrete sur les
  # imports distants sans analyser le fichier, et son silence avait ete pris pour un feu vert.
  # Ici, imports distants autorises : c'est une vraie verification, et un echec arrete tout.
  if command -v deno >/dev/null 2>&1; then
    if ! ERREURS=$(cd "supabase/functions/$F" && deno check index.ts 2>&1); then
      echo "KO  $F : erreurs de type, rien n'a ete deploye"
      echo "$ERREURS" | grep -E "ERROR|error" | head -5 | sed 's/^/      /'
      exit 1
    fi
  else
    echo "!!  $F : deno absent, verification de types impossible — deploiement refuse par prudence"
    exit 1
  fi

  AVANT=$(etat "$F")
  if [ "$AVANT" = "False" ]; then
    supabase functions deploy "$F" --project-ref "$REF" --no-verify-jwt >/dev/null
  else
    # Nouvelle fonction ou fonction deja protegee : le reglage par defaut (true) est le bon.
    supabase functions deploy "$F" --project-ref "$REF" >/dev/null
  fi
  APRES=$(etat "$F")
  if [ "$AVANT" = "absente" ] || [ "$AVANT" = "$APRES" ]; then
    echo "ok  $F  (verify_jwt : $APRES)"
  else
    # Ne devrait jamais arriver. Si c'est le cas, le dire tres fort : c'est une panne silencieuse.
    echo "KO  $F  verify_jwt est passe de $AVANT a $APRES — A CORRIGER IMMEDIATEMENT"
    exit 1
  fi
done
