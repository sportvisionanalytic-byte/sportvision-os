// LA FILE DE RECONNAISSANCE : LE COMPTEUR D'ESSAIS MESURE L'ECHEC, PAS L'INTERRUPTION.
//
// POURQUOI CE TEST EXISTE. v348 a mis un compteur d'essais pour qu'une galerie qui plante ne bloque
// plus la file : on compte l'essai AVANT de travailler, et au troisieme on abandonne. Correct pour
// une galerie cassee. Faux pour une galerie longue : « Villemomble vs OPB », 161 photos et environ
// quarante minutes de calcul, affichait deja essais = 2 le 29/09/2026 sans avoir jamais plante —
// le service avait simplement redemarre deux fois pendant qu'elle avancait. Au troisieme
// redemarrage, une galerie parfaitement saine sortait de la file avec le motif « abandonne apres
// 3 essais sans succes ».
//
// C'etait la panne la plus probable du moteur, et la pire : les GROSSES galeries sont exactement
// celles qu'on interrompt le plus souvent. On aurait perdu les albums lourds et garde les petits,
// en silence.
//
// v349 ajoute `reconnaissance_progresse` : vingt photos calculees prouvent que le travail n'est pas
// casse, son budget repart de zero. Ce test verifie les trois choses qui doivent rester vraies :
//   1. le moteur peut remettre un compteur a zero ;
//   2. personne d'autre ne peut appeler ces deux fonctions ;
//   3. un travail qui n'avance jamais atteint bien ses trois essais et sort de la file.
//
// Il travaille sur une ligne temoin qu'il cree puis supprime, jamais sur la vraie file.

import { rapporteur } from "./_session-os.mjs";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const U = env.SUPABASE_URL, MOTEUR = env.SUPABASE_SECRET_KEY, ANON = env.SUPABASE_ANON_KEY;
const h = (k) => ({ apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" });
const { t, bilan } = rapporteur();

const appeler = async (k, nom, corps) => {
  const r = await fetch(`${U}/rest/v1/rpc/${nom}`, { method: "POST", headers: h(k), body: JSON.stringify(corps) });
  const txt = await r.text();
  let d = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
  return { statut: r.status, d };
};
const lire = async (id) => {
  const r = await fetch(`${U}/rest/v1/reconnaissance_a_faire?select=id,essais,traite_le,resultat&id=eq.${id}`, { headers: h(MOTEUR) });
  return (await r.json())[0] || null;
};

// Un album quelconque suffit : on ne demande a personne de le traiter, la ligne temoin est
// supprimee avant la fin. Mais il doit etre LIBRE : `idx_reconnaissance_file_sans_sportif` interdit
// deux travaux sans sportif en attente sur le meme album, et le rattrapage en a mis partout.
const rAlb = await fetch(`${U}/rest/v1/media_albums?select=id&order=created_at.desc&limit=200`, { headers: h(MOTEUR) });
const albums = (await rAlb.json()).map((a) => a.id);
const rFile = await fetch(`${U}/rest/v1/reconnaissance_a_faire?select=album_id&traite_le=is.null&player_id=is.null`, { headers: h(MOTEUR) });
const occupes = new Set((await rFile.json()).map((l) => l.album_id));
const album = albums.find((id) => !occupes.has(id));
if (!album) { console.log("  KO   aucune galerie libre : relancer quand la file sera vide"); process.exit(1); }

const rNew = await fetch(`${U}/rest/v1/reconnaissance_a_faire`, {
  method: "POST", headers: { ...h(MOTEUR), Prefer: "return=representation" },
  // traite_le dans le futur ? Non : on la laisse en attente et on la supprime a la fin. Une
  // priorite tres basse (99) garantit qu'aucun passage de moteur ne la prendra avant.
  body: JSON.stringify({ album_id: album, player_id: null, priorite: 9 }),
});
const temoin = (await rNew.json())[0];
if (!temoin?.id) { console.log("  KO   ligne temoin non creee"); process.exit(1); }

try {
  // 1. LE BUDGET REPART DE ZERO QUAND LE TRAVAIL AVANCE.
  await fetch(`${U}/rest/v1/reconnaissance_a_faire?id=eq.${temoin.id}`, {
    method: "PATCH", headers: { ...h(MOTEUR), Prefer: "return=minimal" }, body: JSON.stringify({ essais: 2 }),
  });
  t("rouge avant : le temoin porte bien 2 essais", (await lire(temoin.id))?.essais === 2);
  await appeler(MOTEUR, "reconnaissance_progresse", { p_ids: [temoin.id] });
  t("vert apres : un travail qui avance repart de zero", (await lire(temoin.id))?.essais === 0);

  // 2. CES FONCTIONS APPARTIENNENT AU MOTEUR SEUL.
  const anonP = await appeler(ANON, "reconnaissance_progresse", { p_ids: [temoin.id] });
  t("un compte anonyme ne peut pas remettre un compteur a zero", anonP.statut === 401 || anonP.statut === 403,
    `recu ${anonP.statut} ${JSON.stringify(anonP.d).slice(0, 80)}`);
  const anonC = await appeler(ANON, "reconnaissance_commencer", { p_ids: [temoin.id] });
  t("un compte anonyme ne peut pas bruler le budget d'un travail", anonC.statut === 401 || anonC.statut === 403,
    `recu ${anonC.statut} ${JSON.stringify(anonC.d).slice(0, 80)}`);

  // 3. UN TRAVAIL QUI N'AVANCE JAMAIS SORT BIEN DE LA FILE AU TROISIEME ESSAI.
  //    C'est la raison d'etre de v348 : elle doit survivre a v349.
  let dernier = null;
  for (let i = 1; i <= 4; i++) dernier = await appeler(MOTEUR, "reconnaissance_commencer", { p_ids: [temoin.id] });
  const fin = await lire(temoin.id);
  t("quatre essais sans progres : le travail est abandonne", fin?.traite_le !== null,
    `traite_le=${fin?.traite_le} essais=${fin?.essais}`);
  t("et l'abandon dit pourquoi", typeof fin?.resultat === "string" && fin.resultat.includes("abandonn"),
    `resultat=${fin?.resultat}`);
  t("un travail abandonne ne revient plus dans la file", Array.isArray(dernier.d) && dernier.d.length === 0,
    JSON.stringify(dernier.d).slice(0, 80));
} finally {
  await fetch(`${U}/rest/v1/reconnaissance_a_faire?id=eq.${temoin.id}`, { method: "DELETE", headers: h(MOTEUR) });
  const reste = await lire(temoin.id);
  t("le temoin est bien supprime", reste === null);
}

process.exit(bilan());
