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

# Une adresse differente a chaque execution : depuis le 12/09/2026 le paiement limite aussi les
# tentatives PAR ADRESSE E-MAIL (huit par heure), ce qui est voulu contre l'acharnement mais rendait
# ce script auto-bloquant des la deuxieme execution de l'heure.
MAIL="galerie+$(date +%s)@exemple.fr"
MAIL2="galerie2+$(date +%s)@exemple.fr"

FAIL=0
ok(){ echo "OK   $1${2:+  ($2)}"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }

# L'argent reel ne doit pas bouger. On releve l'historique AVANT de commencer, au lieu d'un nombre
# ecrit en dur : celui-ci valait 4 le 10/09, un essai reel de 1,50 EUR s'est ajoute le meme jour, et
# le test signalait un echec la ou rien n'etait casse. Ce qui compte n'est pas « combien », c'est
# « autant qu'avant ».
HISTO_AVANT=$(sql "select count(*)::text as v from media_orders where status in ('paid','refunded') and album_id not in (select id from media_albums where title like 'ZZ TEST%')" | jqv v)

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

# Le lien porte ses FORMULES. Sans elles, media_gallery_quote rend NULL et le paiement repond
# « Cette galerie n'est plus disponible a l'achat » — mesure du 10/09/2026, apres le passage au
# modele multi-offres. Ce script construisait encore un lien nu, a l'ancienne : il mesurait alors
# le refus, pas la chaine de paiement. L'insertion vient APRES l'extraction du slug (une premiere
# version la placait avant, le lien n'etait pas encore resolu et rien n'etait cree), et sa sortie
# n'est plus jetee : une erreur ici doit se voir.
LINKID=$(sql "select id from media_album_links where slug='$SLUG';" | jqv id)
sql "insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label, display_order, offer_type, is_enabled)
 select '$LINKID', p.id, p.price_cents,
        case when p.type='pack' then 5 else 1 end,
        p.name, row_number() over (order by p.price_cents),
        -- offer_type n'accepte que 'pack' ou 'album_complet'. media_products.type connait en plus
        -- 'photo_unite' : le passer tel quel faisait echouer l'INSERT ENTIER, donc les DEUX
        -- formules, et le paiement repondait « galerie plus disponible ». Une photo a l'unite est
        -- un pack de 1.
        case when p.type = 'album_complet' then 'album_complet' else 'pack' end, true
   from media_products p
  where p.club_id='$CLUB' and p.name in ('Photo a l unite','Pack 5 photos') returning id;" | head -c 120
NBOFF=$(sql "select count(*)::text as v from media_album_link_offers where link_id='$LINKID'" | jqv v)
[ "$NBOFF" = "2" ] && ok "2 formules posees sur le lien" || ko "formules du lien" "$NBOFF posee(s)"
# Avec plusieurs formules, la fonction de paiement EXIGE qu'on dise laquelle : « Choisissez une
# formule avant de payer ». C'est le modele multi-offres, et c'est volontaire — elle ne devine pas.
# Le script, ecrit avant, n'envoyait rien et mesurait donc ce refus.
OFFRE_PACK=$(sql "select id from media_album_link_offers where link_id='$LINKID' and photos_allowance=5 limit 1;" | jqv id)
OFFRE_UNITE=$(sql "select id from media_album_link_offers where link_id='$LINKID' and photos_allowance=1 limit 1;" | jqv id)
IDS=$(sql "select json_agg(id)::text as j from (select id from media_assets where album_id='$ALBUM' order by position limit 4) s" | jqv j)
IDS2=$(sql "select json_agg(id)::text as j from (select id from media_assets where album_id='$ALBUM' order by position limit 2) s" | jqv j)
echo "galerie $SLUG ($ALBUM)"
echo

# ── 1. Checkout : 4 photos -> le pack 5 doit s'appliquer (15 EUR) ────────
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS,\"offerId\":\"$OFFRE_PACK\",\"email\":\"$MAIL\",\"nom\":\"Camille Martin\"}")
echo "$RESP" | grep -q 'checkout.stripe.com' && ok "session de paiement Stripe creee" || ko "session Stripe" "$(echo "$RESP" | head -c 200)"

MONTANT=$(sql "select amount_cents::text as v from media_orders order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "1500" ] && ok "prix calcule EN BASE : 4 photos = pack 5 (15 EUR)" "$MONTANT c" || ko "prix serveur" "$MONTANT"
NBITEMS=$(sql "select count(*)::text as v from media_order_items oi join media_orders o on o.id=oi.order_id where o.album_id='$ALBUM'" | jqv v)
[ "$NBITEMS" = "4" ] && ok "4 lignes de commande, une par photo" || ko "lignes de commande" "$NBITEMS"
GUEST=$(sql "select (purchased_by_user_id is null and guest_email='$MAIL')::text as v from media_orders order by created_at desc limit 1" | jqv v)
[ "$GUEST" = "true" ] && ok "commande INVITEE : aucun compte cree, aucun beneficiaire invente" || ko "commande invitee" "$GUEST"

# ── 2. Le client ne peut pas choisir son prix ───────────────────────────
sql "delete from media_orders where album_id='$ALBUM';" > /dev/null
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS,\"offerId\":\"$OFFRE_PACK\",\"email\":\"$MAIL\",\"nom\":\"Camille Martin\",\"amount_cents\":1,\"total\":1,\"price\":1}")
MONTANT=$(sql "select amount_cents::text as v from media_orders order by created_at desc limit 1" | jqv v)
[ "$MONTANT" = "1500" ] && ok "montant force par le client : ignore" "$MONTANT c au lieu de 1" || ko "FUITE prix force" "$MONTANT"

# ── 3. Jeton invalide, photos d'une autre galerie ───────────────────────
RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"faux\",\"assetIds\":$IDS,\"offerId\":\"$OFFRE_PACK\",\"email\":\"$MAIL2\",\"nom\":\"Test Test\"}")
echo "$RESP" | grep -q "plus disponible" && ok "mauvais jeton : aucun paiement possible" || ko "mauvais jeton" "$(echo "$RESP" | head -c 120)"

RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":[\"00000000-0000-0000-0000-000000000123\"],\"offerId\":\"$OFFRE_UNITE\",\"email\":\"$MAIL2\",\"nom\":\"Test Test\"}")
echo "$RESP" | grep -q "plus disponible" && ok "photo etrangere a la galerie : refusee" || ko "photo etrangere" "$(echo "$RESP" | head -c 120)"

RESP=$(curl -s -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS2,\"offerId\":\"$OFFRE_UNITE\",\"email\":\"pas-un-email\",\"nom\":\"Test Test\"}")
echo "$RESP" | grep -q "e-mail invalide" && ok "adresse e-mail invalide : refusee" || ko "email invalide" "$(echo "$RESP" | head -c 120)"

# ── 4. Livraison : on place la commande dans l'etat que produit le webhook ──
sql "delete from media_orders where album_id='$ALBUM';" > /dev/null
curl -s -o /dev/null -X POST "$SB/functions/v1/create-gallery-checkout" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"token\":\"$TOKEN\",\"assetIds\":$IDS2,\"offerId\":\"$OFFRE_PACK\",\"email\":\"$MAIL\",\"nom\":\"Camille Martin\"}"
# La formule PACK, pas celle a l'unite : la livraison porte sur DEUX photos, et une formule a
# l'unite en couvre une seule — « Vous avez choisi 2 photos, cette formule en couvre 1 ». La
# commande n'etait alors jamais creee, et toute la moitie « livraison » de ce script echouait avec
# « Requete incomplete » sans que rien n'explique pourquoi.
ORDER=$(sql "select id from media_orders where album_id='$ALBUM' order by created_at desc limit 1" | jqv id)
GTOKEN=$(sql "update media_orders set status='paid', paid_at=now() where id='$ORDER';
 insert into media_download_grants (order_id, email) values ('$ORDER','$MAIL') returning token;" | jqv token)

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
# On supprime dans l'ordre des dependances, sinon les cles etrangeres bloquent en silence et le
# decor reste. Et on ne supprime QUE les deux produits crees ici : la ligne precedente faisait
# `delete from media_products where club_id=...`, ce qui aurait efface les VRAIS produits du club.
# Elle n'a rien detruit parce que ce club de test n'en a jamais eu d'autres — mais sur un club
# reel, elle aurait emporte son catalogue.
sql "delete from media_download_grants where order_id in (select id from media_orders where album_id='$ALBUM');
     delete from media_order_items where order_id in (select id from media_orders where album_id='$ALBUM');
     delete from media_orders where album_id='$ALBUM';
     delete from media_album_link_offers where link_id in (select id from media_album_links where album_id='$ALBUM');
     delete from media_album_links where album_id='$ALBUM';
     delete from media_assets where album_id='$ALBUM';
     delete from media_albums where id='$ALBUM';
     delete from media_products where club_id='$CLUB' and name in ('Photo a l unite','Pack 5 photos');" > /dev/null

# Les sessions Stripe ouvertes par ce script sont REELLES (mode live) : on les expire.
#
# Constat du 10/09/2026 : ce script avait laisse onze sessions de paiement ouvertes dans le compte
# Stripe de production, a 15 EUR chacune. Personne n'en avait l'adresse, et aucune n'a ete payee —
# verifie. Mais c'etaient de vrais liens payables, vers des commandes que ce meme script venait de
# supprimer : un paiement dessus aurait ete ENCAISSE SANS COMMANDE, et le webhook n'aurait rien
# trouve a quoi le rattacher. « Aucun paiement n'est encaisse », disait l'en-tete : c'etait vrai,
# mais seulement parce que personne n'avait clique.
SK=$(grep '^STRIPE_SECRET_KEY=rk_live' .env 2>/dev/null | cut -d= -f2-)
if [ -n "$SK" ]; then
  EXP=0
  for ID in $(curl -sS "https://api.stripe.com/v1/checkout/sessions?limit=100&status=open" -u "$SK:" \
      | python3 -c "import json,sys;[print(s['id']) for s in json.load(sys.stdin).get('data',[]) if (s.get('customer_email') or (s.get('customer_details') or {}).get('email') or '') in ('$MAIL','$MAIL2')]"); do
    curl -sS -o /dev/null -X POST "https://api.stripe.com/v1/checkout/sessions/$ID/expire" -u "$SK:" && EXP=$((EXP+1))
  done
  RESTE=$(curl -sS "https://api.stripe.com/v1/checkout/sessions?limit=100&status=open" -u "$SK:" \
      | python3 -c "import json,sys;print(sum(1 for s in json.load(sys.stdin).get('data',[]) if (s.get('customer_email') or (s.get('customer_details') or {}).get('email') or '') in ('$MAIL','$MAIL2')))")
  [ "$RESTE" = "0" ] && ok "sessions Stripe de test expirees" "$EXP" || ko "sessions Stripe encore ouvertes" "$RESTE"
fi

# Le residu se mesure sur CE QUE CE SCRIPT A CREE, pas sur la base entiere.
# Le controle precedent comptait toutes les lignes de toutes les tables et exigeait zero partout :
# ecrit quand la base etait vide, il ne pouvait plus jamais passer des qu'une vraie commande
# existait — et il aurait masque un vrai residu au milieu du bruit.
R=$(sql "select (select count(*) from media_albums where id='$ALBUM') a,
                (select count(*) from media_assets where album_id='$ALBUM') b,
                (select count(*) from media_orders where album_id='$ALBUM') c,
                (select count(*) from media_album_links where album_id='$ALBUM') d,
                (select count(*) from media_products where club_id='$CLUB' and name in ('Photo a l unite','Pack 5 photos')) e;")
echo "$R" | grep -q '"a":0,"b":0,"c":0,"d":0,"e":0' && ok "aucun residu de ce test" || ko "residu" "$R"

# Et l'argent reel n'a pas bouge : c'est la verification qui compte le plus dans ce fichier.
# On compte l'HISTORIQUE, pas les seules commandes « paid » : depuis le 10/09/2026, la commande a
# 4 EUR du test du 07/09 est remboursee et passe en « refunded ». Elle reste en base — c'est tout
# l'objet de la decision de Fouka — et doit donc toujours etre comptee.
HISTO=$(sql "select count(*)::text as v from media_orders where status in ('paid','refunded') and album_id not in (select id from media_albums where title like 'ZZ TEST%')" | jqv v)
[ "$HISTO" = "$HISTO_AVANT" ] && ok "les commandes historiques sont intactes" "$HISTO payees ou remboursees" || ko "historique des commandes" "$HISTO au lieu de $HISTO_AVANT"

echo
[ "$FAIL" = "0" ] && echo "Tout est vert." || echo "$FAIL echec(s)."
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
