// L'APERÇU SANS FILIGRANE SE JUGE PHOTO PAR PHOTO (v430 / v431 / v432, 01/10/2026).
//
// CE QUE CE TEST EMPÊCHE DE REVENIR. Le 01/10/2026, une famille ayant payé le Pass Photo d'un match
// obtenait l'aperçu SANS FILIGRANE des 110 photos de la galerie — dont celles des autres enfants —
// par trois chemins indépendants :
//
//   1. `media_galerie_a_identifier` lui nommait les 110 photos avec leur chemin d'aperçu public ;
//   2. le chemin de l'aperçu net s'en déduit (`<album>/<id>-p.webp` → `apercus-clairs/…-pc.webp`)
//      et la policy de stockage ne demandait que « a-t-elle le Pass de CETTE GALERIE » ;
//   3. `media_famille_marque` la laissait se marquer sur n'importe quelle photo, ce qui rendait le
//      net légitimement, par `media_photos_du_joueur`.
//
// Il s'exécute par LE CHEMIN RÉEL : vrai compte, vrai jeton, vraies requêtes HTTP. Une vérification
// faite en `postgres` aurait répondu oui partout.
//
// Il N'ÉCRIT RIEN qu'il ne défasse : le seul appel qui écrirait est celui qui doit être refusé, et
// s'il ne l'est pas, le test retire ce qu'il a posé puis échoue.
//
//   node livrables/SportVision-TV/tests/apercu-net-photo-par-photo.test.mjs

import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const MDP = "DemoSportVision2026!";
const FAMILLE = "demo.joueur.fontainebleau@example.invalid";
const COACH = "demo.coach.fontainebleau@example.invalid";

// Le décor : la galerie « RCPF VS PSG U16 », le sportif de la famille, et une photo de cette galerie
// qui n'est PAS la sienne et ne lui a jamais été proposée.
const JOUEUR = "4ffcdc0b-e0e8-469d-b257-a4ca0c4eda62";
const ALBUM = "5536bdea-34d8-47da-a889-82f3b3eef3af";
const PHOTO_TIERCE = "c3c102be-b48f-4bff-b4f2-5f66fcfa526b";
const APERCU_TIERS =
  `apercus-clairs/${ALBUM}/${PHOTO_TIERCE}-pc.webp`;

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom, detail); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

async function session(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`connexion impossible pour ${email} : ${d.error_description || d.msg}`);
  return { apikey: ANON, Authorization: `Bearer ${d.access_token}` };
}
const rpc = async (h, nom, corps = {}) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${nom}`, {
    method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(corps),
  });
  return { statut: r.status, d: await r.json().catch(() => null) };
};
const signer = async (h, chemin) => {
  const r = await fetch(`${SB}/storage/v1/object/sign/sportvision-media-prive/${chemin}`, {
    method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  return { statut: r.status, d: await r.json().catch(() => null) };
};

console.log("\n── LA FAMILLE, PASS PAYÉ ────────────────────────────────────");
const famille = await session(FAMILLE);

// 1. La liste « à identifier » ne nomme plus que ce qui la concerne (v432).
const liste = await rpc(famille, "media_galerie_a_identifier", { p_album_id: ALBUM, p_player_id: JOUEUR });
const lignes = Array.isArray(liste.d) ? liste.d : [];
const etrangeres = lignes.filter((x) => !x.mienne && !x.suggeree);
t("aucune photo ni sienne ni proposée ne lui est nommée",
  liste.statut === 200 && etrangeres.length === 0,
  `${etrangeres.length} étrangère(s) sur ${lignes.length} rendue(s)`);

// 2. L'aperçu net d'une photo qui n'est pas la sienne ne se signe pas (v430).
const refus = await signer(famille, APERCU_TIERS);
t("l'aperçu sans filigrane d'une photo tierce ne se signe pas", refus.statut !== 200, `HTTP ${refus.statut}`);

// 3. Et ce qui EST à elle se signe toujours : une règle trop serrée casserait le produit.
const siennes = await rpc(famille, "media_photos_du_joueur", { p_album_id: ALBUM, p_player_id: JOUEUR });
const avecNet = (Array.isArray(siennes.d) ? siennes.d : []).filter((x) => x.preview_clair_path);
t("ses photos à elle sont toujours servies en net", avecNet.length > 0, `${avecNet.length} photo(s)`);
if (avecNet.length) {
  const s = await signer(famille, avecNet[0].preview_clair_path);
  t("et leur aperçu net se signe", s.statut === 200, `HTTP ${s.statut}`);
}

// 4. « C'est moi » sur une photo qu'on ne lui a pas proposée est refusé (v431).
const revendique = await rpc(famille, "media_famille_marque",
  { p_asset_id: PHOTO_TIERCE, p_player_id: JOUEUR, p_cest_lui: true });
const refuse = revendique.statut >= 400;
t("elle ne peut pas se marquer sur une photo non proposée", refuse,
  `HTTP ${revendique.statut} ${JSON.stringify(revendique.d).slice(0, 90)}`);
if (!refuse) {
  // Le test vient d'écrire ce qu'il dénonce : il le retire avant de rendre son verdict.
  await rpc(famille, "media_famille_marque",
    { p_asset_id: PHOTO_TIERCE, p_player_id: JOUEUR, p_cest_lui: false });
  console.log("      (marquage de test retiré)");
}

console.log("\n── LE CLUB, QUI PUBLIE CES PHOTOS ───────────────────────────");
// Une règle trop serrée se verrait ici : le coach commente et choisit les photos de son équipe.
const coach = await session(COACH);
const vuCoach = await signer(coach, APERCU_TIERS);
t("le coach du club lit toujours les aperçus nets de sa galerie", vuCoach.statut === 200, `HTTP ${vuCoach.statut}`);

console.log("\n── UN VISITEUR SANS COMPTE ──────────────────────────────────");
const anon = { apikey: ANON, Authorization: `Bearer ${ANON}` };
const vuAnon = await signer(anon, APERCU_TIERS);
t("un visiteur sans compte n'obtient aucun aperçu net", vuAnon.statut !== 200, `HTTP ${vuAnon.statut}`);

console.log(`\n${ok} ok, ${echecs.length} KO`);
if (echecs.length) { console.log("ÉCHECS :\n  - " + echecs.join("\n  - ")); process.exit(1); }
