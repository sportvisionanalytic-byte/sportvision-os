// Régénérer les dérivés d'une galerie, en rejouant LE CODE DE L'OS.
//
// POURQUOI CE SCRIPT EXISTE. Le 27/09/2026, le responsable production a signalé que « le filigrane
// ne se met pas bien sur toutes les photos ». Mesure : 31 photos déposées le 14/09 n'ont AUCUN
// filigrane, ni sur l'aperçu ni sur la vignette — vérifié en ouvrant les fichiers, pas en lisant un
// drapeau. Elles sont dans deux galeries vendues par lien : qui détenait le lien pouvait enregistrer
// une photo propre au lieu de l'acheter. La v312 les a retirées de la galerie publique en attendant.
//
// POURQUOI ON NE REDESSINE PAS LE FILIGRANE À LA MAIN. Il est dessiné dans le navigateur par
// `_galFiligrane`, avec la police `system-ui` et des métriques de texte propres au moteur de rendu.
// Le réécrire côté serveur produirait un marquage DIFFÉRENT de tous les autres — et deux filigranes
// dans la même galerie se verraient. On extrait donc les fonctions du fichier de l'OS et on les
// exécute dans Chromium, exactement comme le fait le test des dérivés. C'est le code livré qui
// travaille, pas une copie retapée.
//
//   node livrables/SportVision-TV/scripts/regenerer-apercus.mjs            # tout ce qui manque
//   node livrables/SportVision-TV/scripts/regenerer-apercus.mjs <album_id> # une galerie
//
// Reprenable : il ne traite que les photos dont le drapeau n'est pas `true`, donc on peut
// l'interrompre et le relancer.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const RACINE = new URL("../../../", import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(`${RACINE}.env`, "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const URL_SB = env.SUPABASE_URL, CLE = env.SUPABASE_SECRET_KEY;
const BUCKET_APERCUS = "galerie-previews", BUCKET_PRIVE = "sportvision-media-prive";

const rest = async (chemin, init = {}) => {
  const r = await fetch(`${URL_SB}/rest/v1/${chemin}`, {
    ...init, headers: { apikey: CLE, Authorization: `Bearer ${CLE}`,
      "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  const t = await r.text(); try { return { ok: r.ok, d: JSON.parse(t) }; } catch { return { ok: r.ok, d: t }; }
};

// ── Les fonctions de l'OS, extraites telles quelles ────────────────────────────────────────────
const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
function extraire(nom, genre) {
  let debut = genre === "const" ? html.indexOf(`const ${nom}=`) : html.indexOf(`async function ${nom}(`);
  if (debut === -1 && genre !== "const") debut = html.indexOf(`function ${nom}(`);
  if (debut === -1) throw new Error(`introuvable dans l'OS : ${nom}`);
  let prof = 0, vu = false;
  for (let i = debut; i < html.length; i++) {
    if (html[i] === "{") { prof++; vu = true; }
    else if (html[i] === "}") { prof--; if (vu && prof === 0)
      return html.slice(debut, genre === "const" ? html.indexOf(";", i) + 1 : i + 1); }
  }
  throw new Error(`fin introuvable : ${nom}`);
}
const source = ["GAL_MEDIA_CFG|const", "_galDessiner|fn", "_galFiligrane|fn", "_galToBlob|fn"]
  .map((x) => extraire(...x.split("|"))).join("\n");

// ── Ce qu'il y a à refaire ─────────────────────────────────────────────────────────────────────
const album = process.argv[2] || null;
const filtre = album ? `&album_id=eq.${album}` : "";
const { d: photos } = await rest(
  `media_assets?select=id,album_id,original_path,storage_bucket,preview_path,thumb_path,mime_type,bytes` +
  `&status=eq.ready&preview_watermarked=not.is.true&original_path=not.is.null${filtre}&order=album_id,position`);
if (!Array.isArray(photos) || !photos.length) { console.log("  rien à régénérer."); process.exit(0); }
const go = photos.reduce((s, p) => s + Number(p.bytes || 0), 0) / 1024 / 1024 / 1024;
console.log(`  ${photos.length} photo(s) à régénérer, ${go.toFixed(2)} Go d'originaux à relire\n`);

const serveur = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><meta charset=utf-8>"); });
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const navigateur = await chromium.launch();
const page = await navigateur.newPage();
await page.goto(`http://127.0.0.1:${serveur.address().port}/`);
await page.addScriptTag({ content: source });

let faites = 0, ratees = 0;
for (const p of photos) {
  const etiquette = `${p.id.slice(0, 8)}`;
  try {
    // 1. L'original, par une adresse signée : il vit dans un bucket privé.
    const bucket = p.storage_bucket || BUCKET_PRIVE;
    if (bucket !== BUCKET_PRIVE) { console.log(`  ~ ${etiquette} hors Supabase (${bucket}), ignorée`); continue; }
    const s = await fetch(`${URL_SB}/storage/v1/object/sign/${bucket}/${p.original_path}`,
      { method: "POST", headers: { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 600 }) });
    const sj = await s.json();
    const lien = sj.signedURL || sj.signedUrl;
    if (!lien) throw new Error("original introuvable");
    const bin = Buffer.from(await (await fetch(`${URL_SB}/storage/v1${lien}`)).arrayBuffer());

    // 2. Les trois dérivés, par le code de l'OS, dans un vrai navigateur.
    const derives = await page.evaluate(async ({ b64, mime }) => {
      const oct = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([oct], { type: mime || "image/jpeg" }),
        { imageOrientation: "from-image" });
      const enB64 = async (blob) => {
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        return btoa(s);
      };
      const C = GAL_MEDIA_CFG;
      const t = await _galToBlob(_galDessiner(bitmap, C.thumb.max, true, "thumb"), C.thumb.mime, C.thumb.quality);
      const pv = await _galToBlob(_galDessiner(bitmap, C.preview.max, true, "preview"), C.preview.mime, C.preview.quality);
      const pc = await _galToBlob(_galDessiner(bitmap, C.preview.max, false), C.preview.mime, C.preview.quality);
      return { thumb: await enB64(t), preview: await enB64(pv), clair: await enB64(pc),
               w: bitmap.width, h: bitmap.height };
    }, { b64: bin.toString("base64"), mime: p.mime_type });

    // 3. On REMPLACE les fichiers existants : les chemins ne changent pas, donc rien d'autre à
    //    mettre à jour dans la base, et aucune adresse déjà partagée ne se casse.
    const thumbPath = p.thumb_path || `${p.album_id}/${p.id}-t.webp`;
    const previewPath = p.preview_path || `${p.album_id}/${p.id}-p.webp`;
    const clairPath = `apercus-clairs/${p.album_id}/${p.id}-pc.webp`;
    const deposer = async (bucket, chemin, b64) => {
      const r = await fetch(`${URL_SB}/storage/v1/object/${bucket}/${chemin}`, {
        method: "POST", headers: { apikey: CLE, Authorization: `Bearer ${CLE}`,
          "Content-Type": "image/webp", "x-upsert": "true" },
        body: Buffer.from(b64, "base64") });
      if (!r.ok) throw new Error(`dépôt ${chemin} : ${(await r.text()).slice(0, 120)}`);
    };
    await deposer(BUCKET_APERCUS, thumbPath, derives.thumb);
    await deposer(BUCKET_APERCUS, previewPath, derives.preview);
    await deposer(BUCKET_PRIVE, clairPath, derives.clair);

    // 4. Et seulement maintenant, le drapeau. Dans cet ordre : un drapeau posé avant le dépôt
    //    ferait croire la photo protégée alors que le fichier propre serait encore en ligne.
    const { ok } = await rest(`media_assets?id=eq.${p.id}`, { method: "PATCH",
      body: JSON.stringify({ thumb_path: thumbPath, preview_path: previewPath,
        preview_clair_path: clairPath, preview_watermarked: true }) });
    if (!ok) throw new Error("mise à jour de la ligne refusée");
    faites++;
    console.log(`  ok ${etiquette}  ${derives.w}x${derives.h}  ${(bin.length / 1024 / 1024).toFixed(1)} Mo lus`);
  } catch (e) {
    ratees++;
    console.log(`  KO ${etiquette}  ${String(e.message).slice(0, 110)}`);
  }
}
await navigateur.close(); serveur.close();
console.log(`\n  ${faites} régénérée(s), ${ratees} en échec.`);
process.exit(ratees ? 1 : 0);
