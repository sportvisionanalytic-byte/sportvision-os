#!/bin/bash
# Test de bout en bout de la chaîne de stockage, sur la base et les buckets réels.
# Tout ce qui est créé est supprimé à la fin, et le script le vérifie.
set -u
cd "$(dirname "$0")/../../.."
set -a; source .env; set +a
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
SRC=livrables/screenshots-promo/connect-02-dashboard-joueur.png
sips -s format jpeg -s formatOptions 90 "$SRC" --out "$SCRATCH/orig.jpg"    >/dev/null 2>&1
sips -Z 480  -s format jpeg -s formatOptions 72 "$SCRATCH/orig.jpg" --out "$SCRATCH/thumb.jpg"   >/dev/null 2>&1
sips -Z 1600 -s format jpeg -s formatOptions 82 "$SCRATCH/orig.jpg" --out "$SCRATCH/preview.jpg" >/dev/null 2>&1
PROJ=lulgezzpvrlbftbykzrc
SB=https://$PROJ.supabase.co
SECRET=$(grep '^SUPABASE_SECRET_KEY=' livrables/SportVision-Connect/app-next/.env.local | cut -d= -f2-)
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' livrables/SportVision-Connect/app-next/.env.local | cut -d= -f2-)

sql() { curl -s -X POST "https://api.supabase.com/v1/projects/$PROJ/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1")"; }

ok(){ echo "OK   $1"; }
ko(){ echo "KO   $1  -> $2"; FAIL=$((FAIL+1)); }
FAIL=0

# ── Préparation : un album de test ────────────────────────────────────────
ALBUM=$(sql "insert into media_albums (club_id, team_id, saison_id, title, status)
values ('8be55101-0d61-4b27-8d7b-a4761547d88b','bee719f7-d735-4a0b-b070-0d20eb73e7ec',
        (select id from saisons where label='2026-2027'),'ZZ TEST upload galerie','draft')
returning id;" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
ASSET=$(python3 -c "import uuid;print(uuid.uuid4())")
ORIG="media/$ALBUM/$ASSET.jpg"
THUMB="$ALBUM/$ASSET-t.jpg"
PREV="$ALBUM/$ASSET-p.jpg"
echo "album $ALBUM"
echo

# ── 1. Dépôt de l'original dans le bucket privé ───────────────────────────
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/storage/v1/object/sportvision-media-prive/$ORIG" \
  -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" \
  -H "x-upsert: true" --data-binary @"$SCRATCH/orig.jpg")
[ "$C" = "200" ] && ok "original deposé dans sportvision-media-prive (428 Ko)" || ko "depot original" "HTTP $C"

# ── 2. Dépôt des dérivés dans le bucket public ────────────────────────────
for f in "thumb.jpg:$THUMB" "preview.jpg:$PREV"; do
  SRC="${f%%:*}"; DST="${f##*:}"
  C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/storage/v1/object/galerie-previews/$DST" \
    -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: image/jpeg" \
    -H "x-upsert: true" --data-binary @"$SCRATCH/$SRC")
  [ "$C" = "200" ] && ok "derivé deposé : $SRC" || ko "depot $SRC" "HTTP $C"
done

# ── 3. La ligne en base ───────────────────────────────────────────────────
sql "insert into media_assets (id, album_id, club_id, original_path, preview_path, thumb_path,
  original_filename, mime_type, checksum, width, height, bytes, status, position)
values ('$ASSET','$ALBUM','8be55101-0d61-4b27-8d7b-a4761547d88b','$ORIG','$PREV','$THUMB',
  'connect-02-dashboard-joueur.jpg','image/jpeg','checksum-test',2880,1800,428540,'ready',0);" > /dev/null
N=$(sql "select photo_count from media_albums where id='$ALBUM';" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['photo_count'])")
[ "$N" = "1" ] && ok "photo_count derive automatiquement (=1)" || ko "photo_count" "$N"

# ── 4. Un visiteur ANONYME voit la preview ────────────────────────────────
C=$(curl -s -o /dev/null -w '%{http_code}' "$SB/storage/v1/object/public/galerie-previews/$PREV")
[ "$C" = "200" ] && ok "visiteur anonyme : preview accessible (galerie publique)" || ko "preview anonyme" "HTTP $C"
T=$(curl -s -o /dev/null -w '%{content_type}' "$SB/storage/v1/object/public/galerie-previews/$THUMB")
[ "$T" = "image/jpeg" ] && ok "vignette servie avec le bon type MIME" || ko "type vignette" "$T"

# ── 5. Un visiteur ANONYME ne peut PAS récupérer l'original ───────────────
C=$(curl -s -o /dev/null -w '%{http_code}' "$SB/storage/v1/object/public/sportvision-media-prive/$ORIG")
[ "$C" != "200" ] && ok "visiteur anonyme : original inaccessible en public (HTTP $C)" || ko "FUITE original public" "HTTP 200"

C=$(curl -s -o /dev/null -w '%{http_code}' "$SB/storage/v1/object/sportvision-media-prive/$ORIG" -H "apikey: $ANON")
[ "$C" != "200" ] && ok "cle anonyme : original inaccessible (HTTP $C)" || ko "FUITE original cle anon" "HTTP 200"

C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/storage/v1/object/sign/sportvision-media-prive/$ORIG" \
  -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"expiresIn":60}')
[ "$C" != "200" ] && ok "cle anonyme : signature de l'original refusee (HTTP $C)" || ko "FUITE signature anon" "HTTP 200"

# ── 6. Écriture refusée à un anonyme ──────────────────────────────────────
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB/storage/v1/object/galerie-previews/$ALBUM/pirate.jpg" \
  -H "apikey: $ANON" -H "Content-Type: image/jpeg" --data-binary @"$SCRATCH/thumb.jpg")
[ "$C" != "200" ] && ok "anonyme ne peut pas deposer dans le bucket public (HTTP $C)" || ko "FUITE ecriture anon" "HTTP 200"

# ── 7. Nettoyage ──────────────────────────────────────────────────────────
curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/sportvision-media-prive/$ORIG" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"
curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/galerie-previews/$THUMB" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"
curl -s -o /dev/null -X DELETE "$SB/storage/v1/object/galerie-previews/$PREV" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"
sql "delete from media_albums where id='$ALBUM';" > /dev/null

R=$(sql "select (select count(*) from media_assets) a, (select count(*) from media_albums) b;" | python3 -c "import json,sys;d=json.load(sys.stdin)[0];print(str(d['a'])+'/'+str(d['b']))")
# On interroge storage.objects et pas l'URL publique : apres une suppression, le CDN Supabase
# continue de servir le fichier depuis son cache pendant un moment. La table fait foi, pas le CDN.
OBJ=$(sql "select count(*) n from storage.objects where bucket_id='galerie-previews' or (bucket_id='sportvision-media-prive' and name like 'media/%');" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['n'])")
[ "$R" = "0/0" ] && ok "base nettoyee (0 asset, 0 album)" || ko "residu en base" "$R"
[ "$OBJ" = "0" ] && ok "fichiers de test supprimes du stockage" || ko "residu stockage" "$OBJ objet(s)"

echo
[ "$FAIL" = "0" ] && echo "Tout conforme." || echo "$FAIL echec(s)."
