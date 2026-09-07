#!/bin/bash
# Verification d'un VRAI paiement sur le modele multi-offres.
#
# A lancer APRES le paiement, avec l'adresse utilisee :
#   bash tests/galerie-paiement-multi-offres.verif.sh parent@exemple.fr
#
# Ne cree rien, ne modifie rien : il constate, et dit ou la chaine casse si elle casse.
# Il verifie aussi que la vente est correctement ATTRIBUEE (lien, offre) et qu'elle reste hors des
# statistiques normales tant que le lien est marque comme essai.
set -u
cd "$(dirname "$0")/../../.."
set -a; source .env; set +a
PROJ=lulgezzpvrlbftbykzrc
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' livrables/SportVision-Connect/app-connect/.env.local | cut -d= -f2-)
MAIL="${1:-}"
SLUG="${2:-test-paiement-u18}"
ADMIN='b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca'

if [ -z "$MAIL" ]; then echo "Usage : $0 <email-utilise-au-paiement> [slug]"; exit 2; fi

sql(){ curl -s -X POST "https://api.supabase.com/v1/projects/$PROJ/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1")"; }
un(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['$1'] if isinstance(d,list) and d else '')"; }

FAIL=0
ok(){ echo "OK   $1${2:+  ($2)}"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1" "$2"; else ko "$1" "attendu $3, obtenu $2"; fi; }

echo "── La commande ────────────────────────────────────────────────────────"
CMD=$(sql "select id from media_orders where lower(guest_email)=lower('$MAIL') order by created_at desc limit 1;" | un id)
[ -z "$CMD" ] && { echo "KO   aucune commande pour $MAIL"; exit 1; }
echo "     commande $CMD"

L=$(sql "select o.status, o.amount_cents, o.album_id, o.link_id, o.offer_id, o.stripe_payment_intent_id,
                 (select count(*) from media_order_items i where i.order_id=o.id) as photos,
                 (select slug from media_album_links l where l.id=o.link_id) as lien_slug,
                 (select coalesce(x.label,'?') from media_album_link_offers x where x.id=o.offer_id) as offre,
                 (select price_override_cents from media_album_link_offers x where x.id=o.offer_id) as offre_prix,
                 o.purchased_by_user_id is not null as connecte
          from media_orders o where o.id='$CMD';")
g(){ echo "$L" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['$1'])"; }

chk "commande payee"                 "$(g status)"      "paid"
chk "montant encaisse"               "$(g amount_cents)" "150"
chk "exactement 2 photos dans la commande" "$(g photos)" "2"
chk "attribuee au bon lien"          "$(g lien_slug)"   "$SLUG"
chk "attribuee a l offre 2 photos"   "$(g offre_prix)"  "150"
echo "     offre : $(g offre)"
[ -n "$(g stripe_payment_intent_id)" ] && ok "paiement Stripe rattache" "$(g stripe_payment_intent_id)" || ko "paiement Stripe rattache" "aucun payment_intent"
echo "     achat en etant connecte : $(g connecte)"

echo
echo "── Le droit de telechargement ─────────────────────────────────────────"
D=$(sql "select token, claimed_by_user_id is not null as permanent,
                extract(day from (expires_at - now()))::int as jours
         from media_download_grants where order_id='$CMD';")
TOK=$(echo "$D" | un token)
PERM=$(echo "$D" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['permanent'])")
JOURS=$(echo "$D" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['jours'])")
[ -n "$TOK" ] && ok "droit cree" || ko "droit cree" "aucun"
if [ "$PERM" = "True" ]; then ok "droit permanent (achat connecte)"; else
  if [ "$JOURS" -ge 28 ] && [ "$JOURS" -le 31 ]; then ok "droit invite de 30 jours" "$JOURS jours"; else ko "droit invite de 30 jours" "$JOURS jours"; fi
fi

echo
echo "── L e-mail ───────────────────────────────────────────────────────────"
E=$(sql "select status, last_error from notification_outbox where entity_id='$CMD' limit 1;")
ST=$(echo "$E" | un status)
[ "$ST" = "SENT" ] && ok "e-mail envoye" || ko "e-mail" "statut ${ST:-absent} $(echo "$E" | un last_error)"

echo
echo "── Les telechargements ────────────────────────────────────────────────"
A1=$(sql "select asset_id from media_order_items where order_id='$CMD' limit 1;" | un asset_id)
U=$(curl -s -X POST "https://$PROJ.supabase.co/functions/v1/gallery-download" \
  -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOK\",\"assetId\":\"$A1\"}" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('url',''))")
if [ -n "$U" ]; then
  C=$(curl -s -o /tmp/sv-orig.jpg -w '%{http_code}' "$U")
  T=$(stat -f%z /tmp/sv-orig.jpg 2>/dev/null || stat -c%s /tmp/sv-orig.jpg)
  [ "$C" = "200" ] && ok "photo achetee telechargeable" "$((T/1024)) Ko" || ko "photo achetee" "HTTP $C"
else ko "photo achetee" "aucune URL signee"; fi

# La 3e photo de l'album n'a PAS ete achetee : elle doit etre refusee.
A3=$(sql "select m.id from media_assets m
          where m.album_id='$(g album_id)' and m.status='ready'
            and m.id not in (select asset_id from media_order_items where order_id='$CMD')
          limit 1;" | un id)
if [ -n "$A3" ]; then
  R=$(curl -s -X POST "https://$PROJ.supabase.co/functions/v1/gallery-download" \
    -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOK\",\"assetId\":\"$A3\"}")
  echo "$R" | grep -q "ne fait pas partie" && ok "3e photo NON achetee : refusee" || ko "3e photo non achetee" "$R"
else echo "     (toutes les photos de l album ont ete achetees, controle non applicable)"; fi

echo
echo "── L archive ZIP ──────────────────────────────────────────────────────"
curl -s "https://$PROJ.supabase.co/functions/v1/gallery-download-zip?token=$TOK" -o /tmp/sv-zip.zip
N=$(unzip -l /tmp/sv-zip.zip 2>/dev/null | tail -1 | awk '{print $2}')
chk "le ZIP contient exactement 2 fichiers" "${N:-0}" "2"
unzip -tq /tmp/sv-zip.zip >/dev/null 2>&1 && ok "archive valide" || ko "archive" "unzip -t echoue"

echo
echo "── Les statistiques ───────────────────────────────────────────────────"
S=$(sql "set local role authenticated;
         set local request.jwt.claims = '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}';
         select
           (select ca_cents from media_stats_resume(current_date - 2, current_date + 1)) as ca_normal,
           (select commandes from media_stats_resume(current_date - 2, current_date + 1)) as cmd_normal,
           (select ca_cents from media_stats_resume(current_date - 2, current_date + 1, true)) as ca_essais,
           (select commandes from media_stats_resume(current_date - 2, current_date + 1, true)) as cmd_essais;")
h(){ echo "$S" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['$1'])"; }
echo "     sans les essais : $(h ca_normal) c / $(h cmd_normal) commandes"
echo "     avec les essais : $(h ca_essais) c / $(h cmd_essais) commandes"
chk "hors des statistiques normales (lien d essai)" "$(h ca_normal)" "0"

# Avec les essais, la vente doit apparaitre, attribuee au bon lien et a la bonne offre.
V=$(sql "set local role authenticated;
         set local request.jwt.claims = '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}';
         select l.ca_cents, l.commandes from media_stats_liens('$(g album_id)', current_date - 2, current_date + 1, true) l
         where l.link_id='$(g link_id)';")
echo "     lien : $(echo "$V" | un ca_cents) c / $(echo "$V" | un commandes) commande(s)"
O=$(sql "set local role authenticated;
         set local request.jwt.claims = '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}';
         select o.ca_cents, o.ventes, o.nom from media_stats_offres('$(g album_id)', current_date - 2, current_date + 1, true) o
         where o.offer_id='$(g offer_id)';")
echo "     offre « $(echo "$O" | un nom) » : $(echo "$O" | un ca_cents) c / $(echo "$O" | un ventes) vente(s)"
[ -n "$(echo "$O" | un ventes)" ] && ok "vente attribuee a la bonne offre" || ko "attribution offre" "l offre n apparait pas"

echo
[ "$FAIL" -eq 0 ] && echo "tout conforme" || echo "$FAIL ecart(s)"
exit $((FAIL>0))
