// Test réel de la chaîne de génération des dérivés, dans un vrai navigateur.
//
// C'est la seule partie du dépôt qui s'exécute côté client (décodage, redimensionnement,
// filigrane, encodage WebP) : elle ne peut pas être vérifiée depuis Node. On extrait donc les
// fonctions telles qu'elles sont dans SportVision-OS-Full.html, on les injecte dans Chromium, et
// on leur donne une vraie photo.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const OS = new URL("../SportVision-OS-Full.html", import.meta.url).pathname;
// Photo de test fabriquee a la volee depuis une capture du depot : le test ne depend d'aucun
// fichier exterieur et reste rejouable tel quel.
const SRC = new URL("../../screenshots-promo/connect-02-dashboard-joueur.png", import.meta.url).pathname;
const IMG = `${tmpdir()}/sv-galerie-test.jpg`;
execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", SRC, "--out", IMG], { stdio: "ignore" });

const html = readFileSync(OS, "utf8");

/** Extrait une déclaration (const X=...; ou function X(){...}) du fichier de l'OS, en comptant les
 * accolades : on teste le code réellement livré, pas une copie retapée. */
function extract(name, kind) {
  // `async function X(` doit etre cherche en premier : partir de `function X(` amputerait le mot
  // `async` et rendrait le corps invalide (un `await` hors fonction asynchrone), ce qui ferait
  // echouer tout le script injecte d'un coup.
  let start = kind === "const" ? html.indexOf(`const ${name}=`) : html.indexOf(`async function ${name}(`);
  if (start === -1 && kind !== "const") start = html.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`introuvable : ${name}`);
  let depth = 0, seen = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "{") { depth++; seen = true; }
    else if (c === "}") {
      depth--;
      if (seen && depth === 0) {
        const end = html.indexOf(";", i);
        return html.slice(start, kind === "const" ? end + 1 : i + 1);
      }
    }
  }
  throw new Error(`fin introuvable : ${name}`);
}

const source = [
  extract("GAL_MEDIA_CFG", "const"),
  extract("_galDessiner", "fn"),
  extract("_galFiligrane", "fn"),
  extract("_galToBlob", "fn"),
  extract("_galChecksum", "fn"),
].join("\n");

import { createServer } from "node:http";
const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><meta charset=utf-8>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
// 127.0.0.1 est un contexte securise au sens du navigateur, comme l'OS servi en https : c'est la
// seule facon de tester crypto.subtle, indisponible sur about:blank.
await page.goto(`http://127.0.0.1:${port}/`);
await page.addScriptTag({ content: source });

const bytes = readFileSync(IMG);
const result = await page.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bin], "DSC_0001.JPG", { type: "image/jpeg" });
  const buffer = await file.arrayBuffer();

  const checksum = await _galChecksum(buffer);
  const bitmap = await createImageBitmap(new Blob([buffer], { type: file.type }), { imageOrientation: "from-image" });

  const mesure = async (canvas, mime, q) => {
    const blob = await _galToBlob(canvas, mime, q);
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height, bytes: blob.size, type: blob.type };
  };

  const thumb = await mesure(_galDessiner(bitmap, GAL_MEDIA_CFG.thumb.max, false), GAL_MEDIA_CFG.thumb.mime, GAL_MEDIA_CFG.thumb.quality);
  const prevSans = await mesure(_galDessiner(bitmap, GAL_MEDIA_CFG.preview.max, false), GAL_MEDIA_CFG.preview.mime, GAL_MEDIA_CFG.preview.quality);
  const prevAvec = await mesure(_galDessiner(bitmap, GAL_MEDIA_CFG.preview.max, true), GAL_MEDIA_CFG.preview.mime, GAL_MEDIA_CFG.preview.quality);

  // Une petite image ne doit jamais être agrandie. (Image fabriquee en PNG via un canvas :
  // Chromium ne sait pas decoder un SVG avec createImageBitmap.)
  const petitSrc = document.createElement("canvas");
  petitSrc.width = 300; petitSrc.height = 200;
  petitSrc.getContext("2d").fillRect(0, 0, 300, 200);
  const petit = await createImageBitmap(await _galToBlob(petitSrc, "image/png"));
  const petitCanvas = _galDessiner(petit, GAL_MEDIA_CFG.preview.max, false);

  // Le filigrane doit vraiment modifier les pixels, pas juste ne rien casser.
  const ca = _galDessiner(bitmap, 1600, false);
  const cb = _galDessiner(bitmap, 1600, true);
  const a = ca.getContext("2d").getImageData(0, 0, ca.width, ca.height).data;
  const b = cb.getContext("2d").getImageData(0, 0, cb.width, cb.height).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 6) diff++;

  return {
    checksum,
    source: { w: bitmap.width, h: bitmap.height, bytes: file.size },
    thumb, prevSans, prevAvec,
    petit: { w: petitCanvas.width, h: petitCanvas.height },
    pixelsFiligranes: Math.round((diff / (a.length / 4)) * 100),
  };
}, bytes.toString("base64"));

await browser.close();
server.close();

const attendu = readFileSync(IMG).length;
const checks = [
  ["source lue avec son orientation EXIF", result.source.w === 2880 && result.source.h === 1800, `${result.source.w}x${result.source.h}`],
  ["empreinte SHA-256 calculee (64 hex)", /^[0-9a-f]{64}$/.test(result.checksum || ""), (result.checksum || "null").slice(0, 16) + "…"],
  ["vignette bornee a 480 px", Math.max(result.thumb.w, result.thumb.h) === 480, `${result.thumb.w}x${result.thumb.h}`],
  ["vignette encodee en WebP", result.thumb.type === "image/webp", result.thumb.type],
  ["vignette legere (< 60 Ko)", result.thumb.bytes < 60000, Math.round(result.thumb.bytes / 1024) + " Ko"],
  ["apercu borne a 1600 px", Math.max(result.prevAvec.w, result.prevAvec.h) === 1600, `${result.prevAvec.w}x${result.prevAvec.h}`],
  ["apercu raisonnable (< 400 Ko)", result.prevAvec.bytes < 400000, Math.round(result.prevAvec.bytes / 1024) + " Ko"],
  ["ratio d'origine conserve (16:10)", Math.abs(result.prevAvec.w / result.prevAvec.h - 2880 / 1800) < 0.01, (result.prevAvec.w / result.prevAvec.h).toFixed(3)],
  ["petite image jamais agrandie", result.petit.w === 300 && result.petit.h === 200, `${result.petit.w}x${result.petit.h}`],
  // Seuil releve de 5 % a 15 % le 07/09 avec le passage aux formules d'acces : le visiteur voit
  // desormais toute la galerie avant de payer, l'apercu doit rendre une capture d'ecran
  // inutilisable et pas seulement signaler la propriete. Un affaiblissement du filigrane doit
  // faire echouer ce test, pas passer inapercu.
  ["filigrane couvre assez l'apercu (>= 15 %)", result.pixelsFiligranes >= 15, result.pixelsFiligranes + " % de pixels modifies"],
  ["filigrane absent sans l'option", result.prevSans.bytes !== result.prevAvec.bytes, `${Math.round(result.prevSans.bytes / 1024)} Ko sans / ${Math.round(result.prevAvec.bytes / 1024)} Ko avec`],
  ["apercu plus leger que l'original", result.prevAvec.bytes < attendu, `${Math.round(result.prevAvec.bytes / 1024)} Ko < ${Math.round(attendu / 1024)} Ko`],
];

let ko = 0;
for (const [nom, ok, detail] of checks) {
  if (!ok) ko++;
  console.log(`${ok ? "OK  " : "KO  "} ${nom}  (${detail})`);
}
console.log(`\n${checks.length - ko}/${checks.length} conformes`);
process.exit(ko ? 1 : 0);
