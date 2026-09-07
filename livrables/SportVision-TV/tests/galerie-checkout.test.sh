#!/bin/bash
# Chaine de paiement, testee sur la vraie base et les vraies fonctions deployees.
# Aucun paiement n'est encaisse : on verifie que la commande est creee au bon prix, que le prix ne
# peut pas etre force par le client, puis on place la commande dans l'etat "payee" comme le fait le
# webhook pour tester la livraison. Tout est supprime a la fin.
set -u
cd "$(dirname "$0")/../../.."
set -a; source .env; set +a
PROJ=lulgezzpvrlbftbykzrc
SB=https://$PROJ.supabase.co
SECRET=$(grep '^SUPABASE_SECRET_KEY=' livrables/SportVision-Connect/app-next/.env.local | cut -d= -f2-)
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' livrables/SportVision-Connect/app-connect/.env.local | cut -d= -f2-)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
CLUB=8be55101-0d61-4b27-8d7b-a4761547d88b
TEAM=bee719f7-d735-4a0b-b070-0d20eb73e7ec

sql() { curl -s -X POST "https://api.supabase.com/v1/projects/$PROJ/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1")"; }
jqv() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['$1'] if isinstance(d,list) and d else '')"; }

FAIL=0
ok(){ echo "OK   $1${2:+  ($2)}"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }

# ── Galerie reelle : 6 photos, 4 produits ────────────────────────────────
ALBUM=$(sql "insert into media_albums (club_id, team_id, saison_id, title, event_date, status)
 values ('$CLUB','$TEAM',(select id from saisons where label='2026-2027'),'ZZ TEST checkout','2026-09-06','published') returning id;" | jqv id)
sql "insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata) values
 ('$CLUB',(select id from saisons where label='2026-2027'),'Photo a l unite','photo_unite',400,'eur','club','active','{}'),
 ('$CLUB',(select id from saisons where label='2026-2027'),'Pack 5 photos','pack',1500,'eur','club','active','{\"photo_count\":5}');" > /dev/null

SRC=livrables/screenshots-promo/connect-02-dashboard-joueur.png
sips -s format jpeg -s formatOptions 88 "$SRC" --out "$TMP/o.jpg" >/dev/null 2>&1
sips -Z 480 -s format jpeg "$TMP/o.jpg" --out "$TMP/t.jpg" >/dev/null 2>&1
sips -Z 1600 -s format jpeg "$TMP/o.jpg" --out "$TMP/p.jpg" >/dev/null 2>&1
VALUES=""
for i in 0 1 2 3 4 5; do
  A=$(python3 -c "import uuid;print(uuid.uuid4())")
  curl -s -o /dev/null -X POST "$SB/storage/v1/object/sportvision-media-prive/media/$ALBUM/$A.jpg" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @"$TMP/o.jpg"
  curl -s -o /dev/null -X POST "$SB/storage/v1/object/galerie-previews/$ALBUM/$A-t.jpg" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @"$TMP/t.jpg"
  curl -s -o /dev/null -X POST "$SB/storage/v1/object/galerie-previews/$ALBUM/$A-p.jpg" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary @"$TMP/p.jpg"
  VALUES="$VALUES${VALUES:+,}('$A','$ALBUM','$CLUB','media/$ALBUM/$A.jpg','$ALBUM/$A-p.jpg','$ALBUM/$A-t.jpg','DSC_$i.JPG','image/jpeg','sum-$A',2880,1800,428540,'ready',$i)"
done
sql "insert into media_assets (id, album_id, club_id, original_path, preview_path, thumb_path, original_filename, mime_type, checksum, width, height, bytes, status, position) values $VALUES;" > /dev/null

R=$(sql "insert into media_album_links (album_id, slug) values ('$ALBUM', media_gallery_unique_slug('ZZ TEST checkout')) returning slug, token;")
SLUG=$(echo "$R" | jqv slug); TOKEN=$(echo "$R" | jqv token)
IDS=$(sql "select json_agg(id)::text as j from (select id from media_assets where album_id='$ALBUM' order by position limit 4) s" | jqv j)
IDS2=$(sql "select json_agg(id)::text as j from (select id from media_assets where album_id='$ALBUM' order by position limit 2) s" | jqv j)
echo "galerie $SLUG ($ALBUM)"
echo

# ── 1. Checkout : 4 photos -> le pack 5 doit s'appliquer (15 EUR) ────────
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS,\"email\":\"parent@exemple.fr\",\"nom\":\"Camille Martin\"}")
echo "$RESP" | grep -q 'checkout.stripe.com' && ok "session de paiement Stripe creee" || ko "session Stripe" "$(echo "$RESP" | head -c 200)"

MONTANT=$(sql "select amount_cents::text as v from media_orders order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "1500" ] && ok "prix calcule EN BASE : 4 photos = pack 5 (15 EUR)" "$MONTANT c" || ko "prix serveur" "$MONTANT"
NBITEMS=$(sql "select count(*)::text as v from media_order_items oi join media_orders o on o.id=oi.order_id where o.album_id='$ALBUM'" | jqv v)
[ "$NBITEMS" = "4" ] && ok "4 lignes de commande, une par photo" || ko "lignes de commande" "$NBITEMS"
GUEST=$(sql "select (purchased_by_user_id is null and guest_email='parent@exemple.fr')::text as v from media_orders order by created_at desc limit 1" | jqv v)
[ "$GUEST" = "true" ] && ok "commande INVITEE : aucun compte cree, aucun beneficiaire invente" || ko "commande invitee" "$GUEST"

# ── 2. Le client ne peut pas choisir son prix ───────────────────────────
sql "delete from media_orders where album_id='$ALBUM';" > /dev/null
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS,\"email\":\"parent@exemple.fr\",\"nom\":\"Camille Martin\",\"amount_cents\":1,\"total\":1,\"price\":1}")
MONTANT=$(sql "select amount_cents::text as v from media_orders order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "1500" ] && ok "montant force par le client : ignore" "$MONTANT c au lieu de 1" || ko "FUITE prix force" "$MONTANT"

# ── 3. Jeton invalide, photos d'une autre galerie ───────────────────────
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"faux\",\"assetIds\":$IDS,\"email\":\"a@b.fr\",\"nom\":\"Test Test\"}")
echo "$RESP" | grep -q "plus disponible" && ok "mauvais jeton : aucun paiement possible" || ko "mauvais jeton" "$(echo "$RESP" | head -c 120)"

RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":[\"00000000-0000-0000-0000-000000000123\"],\"email\":\"a@b.fr\",\"nom\":\"Test Test\"}")
echo "$RESP" | grep -q "plus disponible" && ok "photo etrangere a la galerie : refusee" || ko "photo etrangere" "$(echo "$RESP" | head -c 120)"

RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS2,\"email\":\"pas-un-email\",\"nom\":\"Test Test\"}")
echo "$RESP" | grep -q "e-mail invalide" && ok "adresse e-mail invalide : refusee" || ko "email invalide" "$(echo "$RESP" | head -c 120)"

# ── 4. Livraison : on place la commande dans l'etat que produit le webhook ──
sql "delete from media_orders where album_id='$ALBUM';" > /dev/null
curl -s -o /dev/null -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS2,\"email\":\"parent@exemple.fr\",\"nom\":\"Camille Martin\"}"
ORDER=$(sql "select id from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv id)
GTOKEN=$(sql "update media_orders set status='paid', paid_at=now() where id='$ORDER';
 insert into media_download_grants (order_id, email) values ('$ORDER','parent@exemple.fr') returning token;" | jqv token)

SUM=$(sql "select (photos)::text as v from media_gallery_order_summary('$(printf '%s' "$GTOKEN" | sed "s/'/''/g")')" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(json.loads(d[0]['v'])) if d else 0)")
[ "$SUM" = "2" ] && ok "recapitulatif de commande : 2 photos" || ko "recapitulatif" "$SUM"

ASSET1=$(sql "select oi.asset_id as id from media_order_items oi where oi.order_id='$ORDER' limit 1" | jqv id)
DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"$GTOKEN\",\"assetId\":\"$ASSET1\"}")
echo "$DL" | grep -q '"url"' && ok "original signe pour une photo achetee" || ko "signature original" "$(echo "$DL" | head -c 160)"
SIGNED=$(echo "$DL" | python3 -c "import json,sys;print(json.load(sys.stdin).get('url',''))")
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SIGNED")
[ "$CODE" = "200" ] && ok "l'URL signee sert bien le fichier" || ko "URL signee" "HTTP $CODE"

# Une photo NON achetee de la meme galerie ne doit pas etre telechargeable.
AUTRE=$(sql "select id from media_assets where album_id='$ALBUM' and id not in (select asset_id from media_order_items where order_id='$ORDER') limit 1" | jqv id)
DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"$GTOKEN\",\"assetId\":\"$AUTRE\"}")
echo "$DL" | grep -q "ne fait pas partie" && ok "photo non achetee : refusee" || ko "FUITE photo non achetee" "$(echo "$DL" | head -c 160)"

DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"faux-jeton\",\"assetId\":\"$ASSET1\"}")
echo "$DL" | grep -q "invalide" && ok "jeton de telechargement invalide : refuse" || ko "jeton invalide" "$(echo "$DL" | head -c 160)"

# Droit expire.
sql "update media_download_grants set expires_at = now() - interval '1 day' where order_id='$ORDER';" > /dev/null
DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"$GTOKEN\",\"assetId\":\"$ASSET1\"}")
echo "$DL" | grep -q "expir" && ok "droit expire : telechargement refuse" || ko "droit expire" "$(echo "$DL" | head -c 160)"
sql "update media_download_grants set expires_at = now() + interval '30 days' where order_id='$ORDER';" > /dev/null

# Commande non payee : aucun droit, meme avec un jeton valide.
sql "update media_orders set status='pending' where id='$ORDER';" > /dev/null
DL=$(curl -s -X POST "$SB/functions/v1/gallery-download" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "{\"token\":\"$GTOKEN\",\"assetId\":\"$ASSET1\"}")
echo "$DL" | grep -q "pas pay" && ok "commande non payee : telechargement refuse" || ko "commande non payee" "$(echo "$DL" | head -c 160)"
SUM=$(sql "select count(*)::text as v from media_gallery_order_summary('$(printf '%s' "$GTOKEN" | sed "s/'/''/g")')" | jqv v)
[ "$SUM" = "0" ] && ok "commande non payee : recapitulatif vide" || ko "recapitulatif non paye" "$SUM"

# ── 5. Nettoyage ────────────────────────────────────────────────────────
sql "select original_path as p from media_assets where album_id='$ALBUM'" | python3 -c "import json,sys;[print(r['p']) for r in json.load(sys.stdin) if r.get('p')]" | while read -r p; do
  curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/sportvision-media-prive/$p" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"; done
sql "select unnest(array[preview_path,thumb_path]) as p from media_assets where album_id='$ALBUM'" | python3 -c "import json,sys;[print(r['p']) for r in json.load(sys.stdin) if r.get('p')]" | while read -r p; do
  curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/galerie-previews/$p" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"; done
sql "delete from media_orders where album_id='$ALBUM'; delete from media_albums where id='$ALBUM'; delete from media_products where club_id='$CLUB';" > /dev/null

R=$(sql "select (select count(*) from media_albums) a, (select count(*) from media_assets) b, (select count(*) from media_orders) c, (select count(*) from media_download_grants) d, (select count(*) from media_products) e, (select count(*) from storage.objects where bucket_id='galerie-previews') f;")
echo "$R" | grep -q '"a":0.*"b":0.*"c":0.*"d":0.*"e":0.*"f":0' && ok "aucun residu" || ko "residu" "$R"

echo
[ "$FAIL" = "0" ] && echo "Tout conforme." || echo "$FAIL echec(s)."
