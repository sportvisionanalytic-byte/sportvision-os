// Ce que le PUBLIC recoit reellement d'une galerie payante, verifie en production.
//
// REBRANCHE LE 10/09/2026. Ce test visait en dur l'album « Test paiement — U18 ». Archive ce jour-la
// avec le decor de test, il a cesse de surveiller quoi que ce soit — et son bilan « 3 ecart(s) » a
// ete lu comme vert parce que la ligne precedente commencait par « OK ». Il cherchait en plus des
// fichiers « -t.jpg » / « -p.jpg », alors que la chaine de l'OS produit du WebP : meme rebranche sur
// une vraie galerie, il n'aurait rien trouve. Il fabrique desormais sa propre galerie temoin, avec
// des derives rendus par le code de l'OS, et la supprime a la fin.
//
// On ne se fie pas au reglage en base ni au code du generateur : on telecharge les fichiers que
// le navigateur telecharge, et on mesure. C'est exactement ce controle qui manquait — le reglage
// disait « filigrane active » alors que les fichiers servis etaient propres.
import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { creerGalerieTemoin } from "./_galerie-temoin.mjs";

// Cle de service : le test est INTERNE. Il a besoin de lire l'original pour prouver que le
// fichier public en differe — c'est justement ce qu'aucun visiteur ne peut faire.
const SB = "https://lulgezzpvrlbftbykzrc.supabase.co";
const SECRET = readFileSync("/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("SUPABASE_SECRET_KEY=")).split("=").slice(1).join("=").trim();

async function signer(chemin) {
  const r = await fetch(`${SB}/storage/v1/object/sign/sportvision-media-prive/${chemin}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 900 }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return SB + "/storage/v1" + d.signedURL;
}

const b = await chromium.launch();
const temoin = await creerGalerieTemoin(b, { nom: "ZZ Temoin filigrane" });
const URL = temoin.url;
const originaux = async () => temoin.assets;
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const vus = [];
p.on("response", (r) => vus.push(r.url()));
await p.goto(URL, { waitUntil: "networkidle" });

// 1. Aucun original ne doit apparaitre, ni en reseau, ni dans le HTML.
dit("aucun original charge par la page", !vus.some((u) => u.includes("sportvision-media-prive")));
const html = await p.content();
dit("aucun chemin d'original dans le DOM", !/sportvision-media-prive/.test(html));
dit("aucune URL signee dans le DOM", !/\/object\/sign\//.test(html));

// On ouvre une photo, comme un parent : l'apercu grand format ne se charge qu'a ce moment-la. Sans
// ce geste, seul la vignette est mesuree et le test declare l'apercu « introuvable ».
await p.locator("img").nth(1).click().catch(() => {});
await p.waitForLoadState("networkidle").catch(() => {});
await p.waitForTimeout(2500);

// 2. Les fichiers reellement servis dans la grille et la visionneuse.
const derives = [...new Set(vus.filter((u) => u.includes("galerie-previews")))];
dit("la grille charge bien des derives publics", derives.length > 0, `${derives.length} fichier(s)`);

/**
 * Compare le fichier REELLEMENT SERVI au public avec le meme derive fabrique SANS filigrane a
 * partir de l'original.
 *
 * C'est la seule mesure qui prouve quelque chose. Compter les pixels clairs ne marche pas : sur
 * une photo sombre, du blanc a 55 % d'opacite ne produit aucun pixel « quasi blanc », et le test
 * conclurait a tort que le filigrane est absent. Comparer a la version propre, en revanche, rend
 * exactement la surface que le filigrane a modifiee.
 */
async function partModifiee(urlServi, cheminOriginal, variante, max) {
  const signed = await signer(cheminOriginal);
  if (!signed) return null;
  return await p.evaluate(async ([urlServi, signed, variante, max]) => {
    const charger = (u) => new Promise((res, rej) => {
      const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => res(i); i.onerror = rej; i.src = u;
    });
    const pixels = (img, w, h) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(img, 0, 0, w, h);
      return x.getImageData(0, 0, w, h).data;
    };
    const servi = await charger(urlServi);
    const orig = await charger(signed);
    const w = servi.naturalWidth, h = servi.naturalHeight;
    const a = pixels(servi, w, h);
    const b = pixels(orig, w, h);
    let diff = 0;
    // Seuil 26 : au-dessus du bruit de recompression JPEG, en dessous d'un trait de filigrane.
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 26) diff++;
    }
    return Math.round((diff / (a.length / 4)) * 100);
  }, [urlServi, signed, variante, max]);
}

// 2b. Le controle qui compte : le fichier PUBLIC differe-t-il de l'original ?
const assets = await originaux();
for (const [nom, motif, seuil] of [["vignette", "-t.", 10], ["apercu", "-p.", 12]]) {
  // L'OS produit « -t.webp » / « -p.webp ». On compare sur le suffixe sans extension.
  const u = derives.find((x) => new RegExp(`${motif.replace(".", "\\.")}(webp|jpg)(\\?|$)`).test(x));
  if (!u) { dit(`${nom} : fichier servi`, false, "introuvable"); continue; }
  const id = u.split("?")[0].split("/").pop().replace(/-(t|p)\.(webp|jpg)$/, "");
  const asset = (assets || []).find((a) => a.id === id);
  if (!asset) { dit(`${nom} : original retrouve`, false, id); continue; }
  const pc = await partModifiee(u, asset.original_path);
  dit(`${nom} : le fichier PUBLIC differe de l'original`, pc !== null && pc >= seuil,
      pc === null ? "mesure impossible" : `${pc} % de la surface modifiee`);
}

// 3. L'original refuse sans droit.
const r = await p.evaluate(async () => {
  const res = await fetch("https://lulgezzpvrlbftbykzrc.supabase.co/storage/v1/object/public/sportvision-media-prive/x.jpg");
  return res.status;
});
dit("le bucket des originaux n'est pas public", r === 400 || r === 404 || r === 403, `HTTP ${r}`);

await b.close();
const menage = await temoin.nettoyer();
dit("la galerie temoin est supprimee, fichiers compris", menage.reste === 0 && !menage.fichierEncoreServi,
  `${menage.reste} ligne(s), fichier public encore servi : ${menage.fichierEncoreServi}`);

// Un bilan qu'on ne peut pas lire de travers : c'est une ligne « OK » suivie de « 3 ecart(s) » qui a
// ete prise pour un succes le 10/09.
console.log(ko === 0 ? "\nRESULTAT : VERT — tout conforme" : `\nRESULTAT : ROUGE — ${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
