#!/bin/bash
# Vendre la galerie d'un TOURNOI : aucune club SportVision, aucune equipe, un acheteur sans compte.
#
# POURQUOI CE FICHIER. galerie-checkout.test.sh verifie la vente pour un club partenaire : un
# club_id, une equipe, une saison, un catalogue de produits. La vente de septembre 2026 porte sur
# des TOURNOIS : la galerie n'est rattachee a aucun club de la base, elle porte seulement le nom de
# la structure. C'est un autre chemin dans le code (media_link_save ne cree alors aucun produit de
# catalogue, l'offre porte elle-meme son nom, son prix et son quota) et il n'etait verifie par
# aucun test de bout en bout.
#
# Aucun paiement n'est encaisse : on verifie que la commande est creee au bon prix, que le prix ne
# peut pas etre force, puis on place la commande dans l'etat « payee » comme le fait le webhook,
# pour tester la livraison. Tout est supprime a la fin, y compris les sessions Stripe ouvertes.
set -u
cd "$(dirname "$0")/../../.."
set -a; source .env; set +a
PROJ=lulgezzpvrlbftbykzrc
SB=https://$PROJ.supabase.co
SECRET=$(grep '^SUPABASE_SECRET_KEY=' livrables/SportVision-Connect/app-next/.env.local | cut -d= -f2-)
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' livrables/SportVision-Connect/app-connect/.env.local | cut -d= -f2-)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

sql() { curl -s -X POST "https://api.supabase.com/v1/projects/$PROJ/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1")"; }
jqv() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['$1'] if isinstance(d,list) and d else '')"; }

FAIL=0
ok(){ echo "OK   $1${2:+  ($2)}"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }

HISTO_AVANT=$(sql "select count(*)::text as v from media_orders where status in ('paid','refunded') and album_id not in (select id from media_albums where title like 'ZZ TEST%')" | jqv v)

# ── La galerie du tournoi : ni club, ni equipe, ni saison ────────────────
ALBUM=$(sql "insert into media_albums (title, structure_externe, event_date, status)
 values ('ZZ TEST tournoi', 'Tournoi de la ville (test)', current_date, 'published') returning id;" | jqv id)
[ -n "$ALBUM" ] && ok "galerie sans club creee" || { ko "creation galerie" "aucun identifiant rendu"; exit 1; }

SRC=livrables/screenshots-promo/connect-02-dashboard-joueur.png
sips -s format jpeg -s formatOptions 88 "$SRC" --out "$TMP/o.jpg" >/dev/null 2>&1
sips -Z 480 -s format jpeg "$TMP/o.jpg" --out "$TMP/t.jpg" >/dev/null 2>&1
sips -Z 1600 -s format jpeg "$TMP/o.jpg" --out "$TMP/p.jpg" >/dev/null 2>&1
VALUES=""
for i in 0 1 2 3; do
  A=$(python3 -c "import uuid;print(uuid.uuid4())")
  curl -s -o /dev/null -X POST "$SB/storage/v1/object/sportvision-media-prive/media/$ALBUM/$A.jpg" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @"$TMP/o.jpg"
  curl -s -o /dev/null -X POST "$SB/storage/v1/object/galerie-previews/$ALBUM/$A-t.jpg" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @"$TMP/t.jpg"
  curl -s -o /dev/null -X POST "$SB/storage/v1/object/galerie-previews/$ALBUM/$A-p.jpg" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @"$TMP/p.jpg"
  VALUES="$VALUES${VALUES:+,}('$A','$ALBUM',null,'media/$ALBUM/$A.jpg','$ALBUM/$A-p.jpg','$ALBUM/$A-t.jpg','TOURNOI_$i.JPG','image/jpeg','sum-$A',2880,1800,428540,'ready',$i)"
done
sql "insert into media_assets (id, album_id, club_id, original_path, preview_path, thumb_path, original_filename, mime_type, checksum, width, height, bytes, status, position) values $VALUES;" > /dev/null
NBP=$(sql "select count(*)::text as v from media_assets where album_id='$ALBUM'" | jqv v)
[ "$NBP" = "4" ] && ok "4 photos deposees sans club" || ko "photos" "$NBP"

# ── Le lien et ses formules ─────────────────────────────────────────────
# media_link_save() ne peut pas etre appelee ici : elle verifie qui appelle (media_pricing_staff_album)
# et ce script s'execute sans identite. Les offres sont donc posees comme la fonction les pose : sur
# le lien, SANS produit de catalogue, ce qui est precisement le cas « galerie sans club ».
R=$(sql "insert into media_album_links (album_id, slug) values ('$ALBUM', media_gallery_unique_slug('ZZ TEST tournoi')) returning slug, token;")
SLUG=$(echo "$R" | jqv slug); TOKEN=$(echo "$R" | jqv token)
LINKID=$(sql "select id from media_album_links where slug='$SLUG';" | jqv id)
sql "insert into media_album_link_offers (link_id, product_id, offer_type, price_override_cents, photos_allowance, label, display_order, is_enabled) values
 ('$LINKID', null, 'pack', 1500, 5, '5 photos du tournoi', 1, true),
 ('$LINKID', null, 'album_complet', 3500, null, 'Toutes les photos', 2, true);" > /dev/null
[ -n "$SLUG" ] && ok "lien de galerie cree sans club" "$SLUG" || ko "creation du lien" "$(echo "$R" | head -c 200)"
NBOFF=$(sql "select count(*)::text as v from media_album_link_offers where link_id='$LINKID'" | jqv v)
[ "$NBOFF" = "2" ] && ok "les 2 formules sont posees sur le lien" || ko "formules" "$NBOFF"
SANSPROD=$(sql "select count(*)::text as v from media_album_link_offers where link_id='$LINKID' and product_id is null" | jqv v)
[ "$SANSPROD" = "2" ] && ok "aucun produit de catalogue orphelin cree" || ko "produits crees a tort" "$SANSPROD"

# ── Ce que voit le visiteur qui ouvre le lien ───────────────────────────
OUV=$(sql "select * from media_gallery_open('$SLUG','$TOKEN',null)")
echo "$OUV" | grep -q '"valide":true' && ok "la galerie s'ouvre pour un visiteur sans compte" || ko "media_gallery_open" "$(echo "$OUV" | head -c 300)"
NBO=$(sql "select jsonb_array_length(coalesce((select offres from media_gallery_open('$SLUG','$TOKEN',null)), '[]'::jsonb))::text as v" | jqv v)
[ "$NBO" = "2" ] && ok "les 2 formules sont proposees a l'achat" || ko "offres invisibles" "$NBO"

OFFRE_PACK=$(sql "select id from media_album_link_offers where link_id='$LINKID' and photos_allowance=5 limit 1;" | jqv id)
OFFRE_TOUT=$(sql "select id from media_album_link_offers where link_id='$LINKID' and offer_type='album_complet' limit 1;" | jqv id)
IDS=$(sql "select json_agg(id)::text as j from (select id from media_assets where album_id='$ALBUM' order by position limit 3) s" | jqv j)
echo "galerie de tournoi $SLUG ($ALBUM)"
echo

# ── 1. Paiement : 3 photos sur la formule a 5 ───────────────────────────
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS,\"offerId\":\"$OFFRE_PACK\",\"email\":\"visiteur@exemple.fr\",\"nom\":\"Camille Martin\"}")
echo "$RESP" | grep -q 'checkout.stripe.com' && ok "session de paiement creee pour une galerie sans club" || ko "session Stripe" "$(echo "$RESP" | head -c 250)"
MONTANT=$(sql "select amount_cents::text as v from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "1500" ] && ok "prix calcule en base : 15 EUR" "$MONTANT c" || ko "prix serveur" "$MONTANT"
GUEST=$(sql "select (purchased_by_user_id is null and guest_email='visiteur@exemple.fr')::text as v from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv v)
[ "$GUEST" = "true" ] && ok "commande invitee : aucun compte cree" || ko "commande invitee" "$GUEST"

# ── 2. Le prix ne se force pas depuis le navigateur ─────────────────────
sql "delete from media_orders where album_id='$ALBUM';" > /dev/null
curl -s -o /dev/null -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS,\"offerId\":\"$OFFRE_PACK\",\"email\":\"visiteur@exemple.fr\",\"nom\":\"Camille Martin\",\"amount_cents\":1,\"total\":1}"
MONTANT=$(sql "select amount_cents::text as v from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "1500" ] && ok "montant force par le client : ignore" "$MONTANT c au lieu de 1" || ko "FUITE prix force" "$MONTANT"

# ── 3. La galerie complete ──────────────────────────────────────────────
sql "delete from media_order_items where order_id in (select id from media_orders where album_id='$ALBUM'); delete from media_orders where album_id='$ALBUM';" > /dev/null
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"offerId\":\"$OFFRE_TOUT\",\"email\":\"visiteur@exemple.fr\",\"nom\":\"Camille Martin\"}")
MONTANT=$(sql "select amount_cents::text as v from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "3500" ] && ok "formule « toutes les photos » : 35 EUR" || ko "prix galerie complete" "$MONTANT — $(echo "$RESP" | head -c 150)"

# ── 4. Livraison, comme apres le webhook ────────────────────────────────
ORDER=$(sql "select id from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv id)
GTOKEN=$(sql "update media_orders set status='paid', paid_at=now() where id='$ORDER';
 insert into media_download_grants (order_id, email) values ('$ORDER','visiteur@exemple.fr') returning token;" | jqv token)
SUM=$(sql "select (photos)::text as v from media_gallery_order_summary('$(printf '%s' "$GTOKEN" | sed "s/'/''/g")')" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(json.loads(d[0]['v'])) if d and d[0].get('v') else 0)")
[ "$SUM" = "4" ] && ok "la galerie complete livre les 4 photos" || ko "recapitulatif" "$SUM"
ASSET1=$(sql "select id from media_assets where album_id='$ALBUM' limit 1" | jqv id)
DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"$GTOKEN\",\"assetId\":\"$ASSET1\"}")
echo "$DL" | grep -q '"url"' && ok "original signe pour une photo achetee" || ko "signature original" "$(echo "$DL" | head -c 200)"
SIGNED=$(echo "$DL" | python3 -c "import json,sys;print(json.load(sys.stdin).get('url',''))")
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SIGNED")
[ "$CODE" = "200" ] && ok "l'URL signee sert bien le fichier" || ko "URL signee" "HTTP $CODE"
DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"faux-jeton\",\"assetId\":\"$ASSET1\"}")
echo "$DL" | grep -q "invalide" && ok "jeton de telechargement invalide : refuse" || ko "jeton invalide" "$(echo "$DL" | head -c 160)"

# ── 5. Nettoyage ────────────────────────────────────────────────────────
sql "select original_path as p from media_assets where album_id='$ALBUM'" | python3 -c "import json,sys;[print(r['p']) for r in json.load(sys.stdin) if r.get('p')]" | while read -r p; do
  curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/sportvision-media-prive/$p" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"; done
sql "select unnest(array[preview_path,thumb_path]) as p from media_assets where album_id='$ALBUM'" | python3 -c "import json,sys;[print(r['p']) for r in json.load(sys.stdin) if r.get('p')]" | while read -r p; do
  curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/galerie-previews/$p" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"; done
sql "delete from media_download_grants where order_id in (select id from media_orders where album_id='$ALBUM');
     delete from media_order_items where order_id in (select id from media_orders where album_id='$ALBUM');
     delete from media_orders where album_id='$ALBUM';
     delete from media_album_link_offers where link_id in (select id from media_album_links where album_id='$ALBUM');
     delete from media_album_links where album_id='$ALBUM';
     delete from media_assets where album_id='$ALBUM';
     delete from media_albums where id='$ALBUM';" > /dev/null
R=$(sql "select (select count(*) from media_albums where id='$ALBUM') a,
                (select count(*) from media_assets where album_id='$ALBUM') b,
                (select count(*) from media_orders where album_id='$ALBUM') c;")
echo "$R" | grep -q '"a":0,"b":0,"c":0' && ok "aucun residu de ce test" || ko "residu" "$R"

# Les sessions Stripe ouvertes ici sont REELLES : on les expire, sinon elles restent payables vers
# des commandes qui n'existent plus (incident du 10/09/2026).
SK=$(grep '^STRIPE_SECRET_KEY=rk_live' .env 2>/dev/null | cut -d= -f2-)
if [ -n "$SK" ]; then
  EXP=0
  for S in $(curl -s "https://api.stripe.com/v1/checkout/sessions?limit=20&status=open" -u "$SK:" \
      | python3 -c "import json,sys;[print(s['id']) for s in json.load(sys.stdin).get('data',[]) if (s.get('customer_email') or (s.get('customer_details') or {}).get('email') or '')=='visiteur@exemple.fr']"); do
    curl -s -o /dev/null -X POST "https://api.stripe.com/v1/checkout/sessions/$S/expire" -u "$SK:"; EXP=$((EXP+1))
  done
  RESTE=$(curl -s "https://api.stripe.com/v1/checkout/sessions?limit=20&status=open" -u "$SK:" \
      | python3 -c "import json,sys;print(sum(1 for s in json.load(sys.stdin).get('data',[]) if (s.get('customer_email') or (s.get('customer_details') or {}).get('email') or '')=='visiteur@exemple.fr'))")
  [ "$RESTE" = "0" ] && ok "sessions Stripe de test expirees" "$EXP" || ko "sessions Stripe encore ouvertes" "$RESTE"
fi

HISTO=$(sql "select count(*)::text as v from media_orders where status in ('paid','refunded') and album_id not in (select id from media_albums where title like 'ZZ TEST%')" | jqv v)
[ "$HISTO" = "$HISTO_AVANT" ] && ok "les commandes historiques sont intactes" "$HISTO" || ko "historique des commandes" "$HISTO au lieu de $HISTO_AVANT"

echo
[ "$FAIL" = "0" ] && echo "Tout est vert." || echo "$FAIL echec(s)."
exit "$FAIL"
