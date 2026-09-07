// Ce que le PUBLIC recoit reellement d'une galerie payante, verifie en production.
//
// On ne se fie pas au reglage en base ni au code du generateur : on telecharge les fichiers que
// le navigateur telecharge, et on mesure. C'est exactement ce controle qui manquait — le reglage
// disait « filigrane active » alors que les fichiers servis etaient propres.
import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

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

async function originaux() {
  const r = await fetch(`${SB}/rest/v1/media_assets?select=id,original_path&album_id=eq.734573a4-c1bb-41b5-9697-b7ebe170b88e&status=eq.ready`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
  return await r.json();
}

const URL = "https://connect.sportvision-an.fr/gallery/test-paiement-u18?k=z8Dk6uTkSSSlFRkvo42j2Ejv";
const b = await chromium.launch();
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
for (const [nom, motif, seuil] of [["vignette", "-t.jpg", 10], ["apercu", "-p.jpg", 12]]) {
  const u = derives.find((x) => x.includes(motif));
  if (!u) { dit(`${nom} : fichier servi`, false, "introuvable"); continue; }
  const id = u.split("/").pop().replace(motif, "");
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
console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
