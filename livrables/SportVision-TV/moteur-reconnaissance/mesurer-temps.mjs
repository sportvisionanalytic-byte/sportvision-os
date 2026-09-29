// OU PASSENT LES 23 SECONDES PAR PHOTO ? (29/09/2026)
//
// Le moteur met environ 40 minutes pour une galerie de 110 photos, quand SportVision promet a la
// famille « reviens dans cinq a dix minutes ». Avant de decider si c'est la machine, le reseau ou
// mon code, on decoupe. Sans mesure, on achete un processeur pour rien — ou on optimise la mauvaise
// etape, ce qui est arrive trois fois aujourd'hui (tuiles, Otsu, silhouettes).
//
// ARRETER LE SERVICE AVANT DE LANCER CECI : deux moteurs sur les memes coeurs donnent des chiffres
// faux, et gonfles.
//   launchctl bootout gui/501/fr.sportvision.reconnaissance
//   node mesurer-temps.mjs [nombre de photos]
//   launchctl bootstrap gui/501 ~/Library/LaunchAgents/fr.sportvision.reconnaissance.plist
import { readFileSync } from "node:fs";
import { visagesDe, detecterFin, MODELE, preparer } from "./visages.mjs";
import { personnesDe, preparerPersonnes } from "./personnes.mjs";
import { lireDossards } from "./dossards.mjs";

const env = Object.fromEntries(readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const URL_SB = env.SUPABASE_URL, CLE = env.SUPABASE_SECRET_KEY;
const ent = { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" };

const COMBIEN = Number(process.argv[2] || 8);
const ALBUM = "5536bdea-34d8-47da-a889-82f3b3eef3af";

const r = await fetch(`${URL_SB}/rest/v1/media_assets?select=id,preview_clair_path&album_id=eq.${ALBUM}`
  + `&preview_clair_path=not.is.null&limit=${COMBIEN}`, { headers: ent });
const photos = await r.json();
if (!Array.isArray(photos) || !photos.length) { console.log("aucune photo"); process.exit(1); }

console.log(`Chargement des modeles...`);
const t00 = Date.now();
await preparer(); await preparerPersonnes();
console.log(`  modeles prets en ${((Date.now() - t00) / 1000).toFixed(1)} s (une fois par service, pas par photo)`);
console.log(`\n${photos.length} photo(s) de la galerie temoin, une par une :\n`);

const tot = { charge: 0, visages: 0, personnes: 0, dossards: 0 };
for (const [i, p] of photos.entries()) {
  const t1 = Date.now();
  const s = await fetch(`${URL_SB}/storage/v1/object/sign/${encodeURI("sportvision-media-prive/" + p.preview_clair_path)}`,
    { method: "POST", headers: ent, body: JSON.stringify({ expiresIn: 900 }) });
  const j = await s.json();
  const rep = await fetch(`${URL_SB}/storage/v1${(j.signedURL || j.signedUrl).startsWith("/") ? "" : "/"}${j.signedURL || j.signedUrl}`);
  const octets = Buffer.from(await rep.arrayBuffer());
  const mCharge = Date.now() - t1;

  const t2 = Date.now();
  const v = await visagesDe(octets, { seuil: 0.3, cotes: [1920, 640] });
  const mVisages = Date.now() - t2;

  const t3 = Date.now();
  const corps = await personnesDe(octets);
  const mPersonnes = Date.now() - t3;

  const t4 = Date.now();
  const nums = corps.length ? await lireDossards(octets, corps, v) : [];
  const mDossards = Date.now() - t4;

  tot.charge += mCharge; tot.visages += mVisages; tot.personnes += mPersonnes; tot.dossards += mDossards;
  const s1 = (ms) => (ms / 1000).toFixed(1).padStart(5);
  console.log(`  ${String(i + 1).padStart(2)}  ${Math.round(octets.length / 1024)} ko`
    + `  telechargement ${s1(mCharge)} s  visages ${s1(mVisages)} s (${v.length})`
    + `  silhouettes ${s1(mPersonnes)} s (${corps.length})  dossards ${s1(mDossards)} s (${nums.length})`
    + `  = ${s1(mCharge + mVisages + mPersonnes + mDossards)} s`);
}

const n = photos.length;
const total = tot.charge + tot.visages + tot.personnes + tot.dossards;
const pc = (ms) => `${Math.round(100 * ms / total)} %`;
console.log(`\nMOYENNE PAR PHOTO : ${(total / n / 1000).toFixed(1)} s`);
console.log(`  telechargement ${(tot.charge / n / 1000).toFixed(1)} s  ${pc(tot.charge)}`);
console.log(`  visages        ${(tot.visages / n / 1000).toFixed(1)} s  ${pc(tot.visages)}`);
console.log(`  silhouettes    ${(tot.personnes / n / 1000).toFixed(1)} s  ${pc(tot.personnes)}`);
console.log(`  dossards       ${(tot.dossards / n / 1000).toFixed(1)} s  ${pc(tot.dossards)}`);
console.log(`\nA ce rythme, une galerie de 110 photos prend ${Math.round(total / n * 110 / 60000)} min.`);
