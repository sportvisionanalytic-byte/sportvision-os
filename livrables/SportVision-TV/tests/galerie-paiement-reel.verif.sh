#!/bin/bash
# Vérification d'un PAIEMENT RÉEL de galerie, à lancer APRÈS l'achat.
#
# Ne crée rien, ne modifie rien : ce script ne fait que constater. Il retrace toute la chaîne
# depuis Stripe jusqu'au fichier téléchargeable, dans l'ordre où elle se déroule, et dit
# précisément où elle casse si elle casse.
#
#   bash livrables/SportVision-TV/tests/galerie-paiement-reel.verif.sh <slug-de-la-galerie>
#
# Le seul argument est le slug du lien public. Tout le reste est retrouvé à partir de là.
set -u
cd "$(dirname "$0")/../../.."
set -a; source .env; set +a
PROJ=lulgezzpvrlbftbykzrc
SB=https://$PROJ.supabase.co
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' livrables/SportVision-Connect/app-connect/.env.local | cut -d= -f2-)
SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "Usage : $0 <slug-de-la-galerie>"; exit 1; }

sql() { curl -s -X POST "https://api.supabase.com/v1/projects/$PROJ/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1")"; }
val() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['$1'] if isinstance(d,list) and d and d[0].get('$1') is not None else '')"; }

FAIL=0
ok(){ echo "OK   $1${2:+  ($2)}"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }
info(){ echo "     $1"; }

ALBUM=$(sql "select a.id from media_albums a join media_album_links l on l.album_id=a.id where lower(l.slug)=lower('$SLUG')" | val id)
[ -z "$ALBUM" ] && { echo "Galerie « $SLUG » introuvable."; exit 1; }
echo "galerie $SLUG"
echo

# ── 1. La commande ────────────────────────────────────────────────────────
ORDER=$(sql "select id from media_orders where album_id='$ALBUM' and status='paid' order by paid_at desc limit 1" | val id)
if [ -z "$ORDER" ]; then
  PEND=$(sql "select count(*)::text as v from media_orders where album_id='$ALBUM'" | val v)
  ko "commande payée" "aucune ; $PEND commande(s) en attente. Le webhook n'a pas traité le paiement."
  echo; echo "$FAIL echec(s) — la chaine s'arrete ici."; exit 1
fi
DET=$(sql "select amount_cents::text||' c | '||coalesce(guest_email,'?')||' | intent '||coalesce(left(stripe_payment_intent_id,14),'ABSENT')||' | compte '||coalesce(purchased_by_user_id::text,'aucun') as v from media_orders where id='$ORDER'" | val v)
ok "commande payée" "$DET"
MONTANT=$(sql "select amount_cents::text as v from media_orders where id='$ORDER'" | val v)
[ "$MONTANT" = "400" ] && ok "montant débité : 4 EUR" || info "montant : $MONTANT c (attendu 400 pour 1 photo)"
INTENT=$(sql "select coalesce(stripe_payment_intent_id,'') as v from media_orders where id='$ORDER'" | val v)
[ -n "$INTENT" ] && ok "identifiant de paiement Stripe enregistré" "$INTENT" || ko "payment_intent" "absent : le webhook ne l'a pas écrit"

# ── 2. Le droit de téléchargement (créé par le webhook v39) ───────────────
GRANT=$(sql "select token from media_download_grants where order_id='$ORDER' limit 1" | val token)
if [ -z "$GRANT" ]; then
  ko "droit de téléchargement" "absent — la branche gallery_order du webhook n'a pas tourné"
else
  JOURS=$(sql "select round(extract(epoch from (expires_at - created_at))/86400)::text as v from media_download_grants where order_id='$ORDER'" | val v)
  ok "droit de téléchargement créé" "valable $JOURS jours"
  [ "$JOURS" = "30" ] && ok "durée conforme (30 jours)" || ko "durée" "$JOURS jours"
fi

# ── 3. L'e-mail ───────────────────────────────────────────────────────────
MAIL=$(sql "select status||' -> '||coalesce(recipient_email,'?')||coalesce(' | '||last_error,'') as v from notification_outbox where entity_id='$ORDER' order by created_at desc limit 1" | val v)
if [ -z "$MAIL" ]; then
  ko "e-mail de confirmation" "aucune entrée dans la file d'envoi"
else
  case "$MAIL" in
    SENT*) ok "e-mail envoyé" "$MAIL";;
    PENDING*|QUEUED*) info "e-mail en file d'attente ($MAIL) — le dispatcher tourne chaque minute, relancez dans 60 s";;
    *) ko "e-mail" "$MAIL";;
  esac
fi

# ── 4. Le téléchargement de la photo achetée ──────────────────────────────
if [ -n "$GRANT" ]; then
  ACHETEE=$(sql "select asset_id as id from media_order_items where order_id='$ORDER' limit 1" | val id)
  DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
       -H "Content-Type: application/json" -d "{\"token\":\"$GRANT\",\"assetId\":\"$ACHETEE\"}")
  SIGNED=$(echo "$DL" | python3 -c "import json,sys;print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
  if [ -n "$SIGNED" ]; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SIGNED")
    TAILLE=$(curl -s -o /dev/null -w '%{size_download}' "$SIGNED")
    [ "$CODE" = "200" ] && ok "original téléchargeable" "$TAILLE octets" || ko "téléchargement" "HTTP $CODE"
  else
    ko "signature de l'original" "$(echo "$DL" | head -c 160)"
  fi

  # ── 5. Une photo NON achetée doit être refusée ──────────────────────────
  AUTRE=$(sql "select id from media_assets where album_id='$ALBUM' and status='ready' and id not in (select asset_id from media_order_items where order_id='$ORDER') limit 1" | val id)
  if [ -n "$AUTRE" ]; then
    DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
         -H "Content-Type: application/json" -d "{\"token\":\"$GRANT\",\"assetId\":\"$AUTRE\"}")
    echo "$DL" | grep -q "ne fait pas partie" \
      && ok "photo NON achetée : refusée" \
      || ko "FUITE : photo non achetée accessible" "$(echo "$DL" | head -c 160)"
  else
    info "aucune photo non achetée à tester (tout l'album a été acheté)"
  fi
fi

# ── 6. Rattachement à un compte Connect ───────────────────────────────────
EMAIL=$(sql "select lower(coalesce(guest_email,'')) as v from media_orders where id='$ORDER'" | val v)
COMPTE=$(sql "select id::text as v from auth.users where lower(email)='$EMAIL' and email_confirmed_at is not null limit 1" | val v)
if [ -z "$COMPTE" ]; then
  info "aucun compte Connect vérifié pour $EMAIL — étape de rattachement à faire après création du compte"
else
  ok "compte Connect trouvé pour $EMAIL" "$COMPTE"
  RATT=$(sql "select (claimed_by_user_id is not null)::text as v from media_download_grants where order_id='$ORDER'" | val v)
  if [ "$RATT" = "true" ]; then
    PERM=$(sql "select (expires_at > now() + interval '10 years')::text as v from media_download_grants where order_id='$ORDER'" | val v)
    ok "commande rattachée au compte"
    [ "$PERM" = "true" ] && ok "droit devenu permanent" || ko "droit permanent" "expiration toujours à 30 jours"
  else
    info "commande pas encore rattachée — appelez media_gallery_claim_order en étant connecté"
  fi
fi

echo
[ "$FAIL" = "0" ] && echo "Chaine complete verifiee." || echo "$FAIL point(s) en echec."
