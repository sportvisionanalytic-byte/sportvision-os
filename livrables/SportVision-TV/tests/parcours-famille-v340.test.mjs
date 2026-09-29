// LE PARCOURS DE LA FAMILLE, VU PAR LA FAMILLE (29/09/2026).
//
// Ce test ne passe PAS par la clé de service : il prend un vrai jeton du compte de la famille et
// appelle les mêmes fonctions que l'application. C'est la leçon du 10/09 — l'API d'administration
// s'exécute en postgres et répond « oui » là où l'application reçoit 403.
//
//   node livrables/SportVision-TV/tests/parcours-famille-v340.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(ICI, "../../../.env"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.SUPABASE_URL, SECRET = env.SUPABASE_SECRET_KEY, ANON = env.SUPABASE_ANON_KEY;
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

const ALBUM = "5536bdea-34d8-47da-a889-82f3b3eef3af";
const JOUEUR = "4ffcdc0b-e0e8-469d-b257-a4ca0c4eda62";

let echecs = 0;
const verifier = (nom, condition, detail = "") => {
  console.log(`${condition ? "  ok  " : "ECHEC "} ${nom}${detail ? ` — ${detail}` : ""}`);
  if (!condition) echecs++;
};

async function jetonDe(userId) {
  const u = await (await fetch(`${SB}/auth/v1/admin/users/${userId}`, { headers: admin })).json();
  const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST", headers: admin,
    body: JSON.stringify({ type: "magiclink", email: u.email, redirect_to: "https://connect.sportvision-an.fr" }),
  })).json()).action_link;
  if (!lien) throw new Error("lien impossible a obtenir");
  const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
  const jeton = new URLSearchParams(loc.split("#")[1] || "").get("access_token");
  if (!jeton) throw new Error("jeton absent de la redirection");
  return jeton;
}

const fiche = (await (await fetch(`${SB}/rest/v1/player_profiles?select=user_id&id=eq.${JOUEUR}`, { headers: admin })).json())[0];
const jeton = await jetonDe(fiche.user_id);
const enFamille = { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };
const rpc = async (nom, corps) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: enFamille, body: JSON.stringify(corps) });
  return { statut: r.status, d: await r.json().catch(() => null) };
};

console.log("\n▸ CE QUE LA FAMILLE VOIT");
const photos = await rpc("media_photos_du_joueur", { p_album_id: ALBUM, p_player_id: JOUEUR });
verifier("la galerie repond a la famille", photos.statut === 200, `statut ${photos.statut}`);
const lignes = Array.isArray(photos.d) ? photos.d : [];
verifier("des photos reviennent", lignes.length > 0, `${lignes.length} ligne(s)`);
const deGroupe = lignes.filter((l) => l.marque_par === "groupe");
verifier("les photos d'equipe en font partie", deGroupe.length > 0,
         `${deGroupe.length} photo(s) de groupe sur ${lignes.length}`);

// ON REMET LE COMPTEUR A ZERO AVANT DE MESURER. Sans cela le test passe une fois et ment ensuite :
// la deuxieme execution trouve la photo deja entree et « photos_ajoutees » vaut zero. Un test qui
// ne peut reussir qu'une fois n'est pas un test.
await fetch(`${SB}/rest/v1/media_player_tags?player_id=eq.${JOUEUR}&source=eq.numero`,
  { method: "DELETE", headers: admin });
await fetch(`${SB}/rest/v1/media_numeros_de_match?player_id=eq.${JOUEUR}`,
  { method: "DELETE", headers: admin });

console.log("\n▸ IL DECLARE SON NUMERO");
const declare = await rpc("media_declarer_mon_numero", { p_album_id: ALBUM, p_player_id: JOUEUR, p_numero: 10 });
verifier("la declaration est acceptee", declare.statut === 200, `statut ${declare.statut} ${JSON.stringify(declare.d).slice(0, 160)}`);
const r = declare.d || {};
verifier("des photos sont AJOUTEES, pas proposees", Number(r.photos_ajoutees) > 0,
         `photos_ajoutees=${r.photos_ajoutees}`);
verifier("l'ecran sait quoi dire sur la suite", typeof r.recherche_en_cours === "boolean",
         `recherche_en_cours=${r.recherche_en_cours}, restantes=${r.photos_a_examiner}`);

console.log("\n▸ CES PHOTOS SONT DANS SA GALERIE, SANS QU'ON LUI DEMANDE RIEN");
const apres = await rpc("media_photos_du_joueur", { p_album_id: ALBUM, p_player_id: JOUEUR });
const parNumero = (Array.isArray(apres.d) ? apres.d : []).filter((l) => l.marque_par === "numero");
verifier("les photos du numero sont entrees", parNumero.length > 0, `${parNumero.length} photo(s)`);
const aTrancher = await rpc("media_photos_a_identifier", { p_album_id: ALBUM, p_player_id: JOUEUR });
const suggerees = Array.isArray(aTrancher.d) ? aTrancher.d.filter((x) => x.suggeree) : [];
verifier("rien n'est mis en attente de confirmation", suggerees.length === 0,
         `${suggerees.length} photo(s) en attente`);

console.log(`\n${echecs ? `${echecs} ECHEC(S)` : "tout est vert"}`);
process.exit(echecs ? 1 : 0);
