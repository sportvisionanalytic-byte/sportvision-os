// Le lecteur de dossards, mesure contre ce qu'un oeil humain voit vraiment.
import { readFileSync } from "node:fs";
import { personnesDe, preparerPersonnes } from "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/cockpit-main/livrables/SportVision-TV/moteur-reconnaissance/personnes.mjs";
import { pixelsDe, lireDossards, fermerOcr } from "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/cockpit-main/livrables/SportVision-TV/moteur-reconnaissance/dossards.mjs";
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const S = process.argv[2];
const photos = JSON.parse(readFileSync(`${S}/photos-etiquetage.json`, "utf8"));
const verite = JSON.parse(readFileSync(`${S}/verite.json`, "utf8"));

async function charger(c) {
  const r = await fetch(`${U}/storage/v1/object/sign/${encodeURI("sportvision-media-prive/" + c)}`,
    { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 3600 }) });
  if (!r.ok) return null;
  const j = await r.json(); const p = j.signedURL || j.signedUrl;
  const rep = await fetch(`${U}/storage/v1${p.startsWith("/") ? "" : "/"}${p}`);
  return rep.ok ? Buffer.from(await rep.arrayBuffer()) : null;
}

await preparerPersonnes();
let vrais = 0, faux = 0, manques = 0, photosSalies = 0;
console.log("photo | attendu | lu");
for (const [i, p] of photos.entries()) {
  const attendu = verite[String(i)] || [];
  const img = await charger(p.preview_clair_path);
  if (!img) continue;
  const pers = await personnesDe(img);
  const image = await pixelsDe(img);
  const det = await lireDossards(image, pers, { detail: true });
  const lus = det.map((x) => x.n);
  if (det.length) for (const d of det)
    console.log(`      ${attendu.includes(d.n) ? "VRAI " : "FAUX "} n=${d.n} confiance=${Math.round(d.c)} voix=${d.voix} chiffres=${d.chiffres} taille=${(d.part*100).toFixed(1)}% du corps ${d.clair ? "clair" : "sombre"}`);
  const bons = lus.filter((n) => attendu.includes(n));
  const mauvais = lus.filter((n) => !attendu.includes(n));
  vrais += bons.length; faux += mauvais.length;
  manques += attendu.filter((n) => !lus.includes(n)).length;
  if (mauvais.length) photosSalies++;
  if (attendu.length || lus.length)
    console.log(`${String(i).padStart(5)} | ${JSON.stringify(attendu).padEnd(10)} | ${JSON.stringify(lus)}`);
}
console.log(`\nretrouves : ${vrais} sur ${vrais + manques}`);
console.log(`inventes  : ${faux}, sur ${photosSalies} photo(s) des ${photos.length}`);
console.log(`precision : ${vrais + faux ? Math.round(100 * vrais / (vrais + faux)) : 0} %`);
await fermerOcr();
