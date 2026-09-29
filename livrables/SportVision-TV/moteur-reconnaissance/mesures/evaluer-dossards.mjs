// Le lecteur de dossards, mesuré contre ce qu'un œil humain voit vraiment.
//
//   node mesures/evaluer-dossards.mjs            les 36 photos étiquetées
//   node mesures/evaluer-dossards.mjs --tout     les 110 de la galerie, pour voir ce qu'il invente
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detecterFin, preparer } from "../visages.mjs";
import { personnesDe, preparerPersonnes } from "../personnes.mjs";
import { lireDossards } from "../dossards.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(ICI, "../../../../.env"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const U = env.SUPABASE_URL, K = env.SUPABASE_SECRET_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };

const verite = JSON.parse(readFileSync(join(ICI, "dossards-verite-terrain.json"), "utf8"));
const TOUT = process.argv.includes("--tout");
const combien = TOUT ? 500 : 36;

async function charger(c) {
  const r = await fetch(`${U}/storage/v1/object/sign/${encodeURI("sportvision-media-prive/" + c)}`,
    { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 3600 }) });
  if (!r.ok) return null;
  const j = await r.json(); const p = j.signedURL || j.signedUrl;
  const rep = await fetch(`${U}/storage/v1${p.startsWith("/") ? "" : "/"}${p}`);
  return rep.ok ? Buffer.from(await rep.arrayBuffer()) : null;
}

const r = await fetch(`${U}/rest/v1/media_assets?select=id,preview_clair_path&album_id=eq.${verite._album}&status=eq.ready&order=position&limit=${combien}`, { headers: H });
const photos = await r.json();
await preparer(); await preparerPersonnes();

let vrais = 0, faux = 0, manques = 0, t0 = Date.now();
console.log("photo | attendu | lu");
for (const [i, p] of photos.entries()) {
  const attendu = verite.dossards[String(i)] || [];
  const img = await charger(p.preview_clair_path);
  if (!img) continue;
  const visages = await detecterFin(img, { seuil: 0.3 });
  const corps = await personnesDe(img);
  const lus = await lireDossards(img, corps, visages);
  // Au-delà des 36 étiquetées, on ne sait pas ce qui est vrai : on liste, et on va regarder.
  const connu = TOUT ? i < 36 : true;
  if (connu) {
    vrais += lus.filter((n) => attendu.includes(n)).length;
    faux += lus.filter((n) => !attendu.includes(n)).length;
    manques += attendu.filter((n) => !lus.includes(n)).length;
  }
  if (attendu.length || lus.length)
    console.log(`${String(i).padStart(5)} | ${JSON.stringify(attendu).padEnd(10)} | ${JSON.stringify(lus)}${connu ? "" : "  (non étiquetée, à vérifier à l'œil)"}`);
}
console.log(`\nsur les 36 étiquetées : ${vrais} retrouvé(s) sur ${vrais + manques}, ${faux} inventé(s).`);
console.log(`${Math.round((Date.now() - t0) / photos.length)} ms par photo.`);
