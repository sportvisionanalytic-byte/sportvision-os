// L'annuaire interne ne doit pas livrer l'adresse du domicile des collegues.
//
// CONSTAT D'ORIGINE (audit du 10/09/2026, reproduit avant tout correctif). Avec le jeton d'un
// vrai compte photographe, cet appel rendait 17 lignes dont deux adresses postales completes :
//
//   GET /rest/v1/profiles?select=prenom,nom,telephone,adresse,code_postal
//
// La policy « Staff lecture annuaire » autorise la lecture de la LIGNE entiere, et la RLS de
// PostgreSQL ne restreint pas les COLONNES. Aucun ecran de l'OS ne montrait ces champs a un
// photographe — mais l'API est publique, donc l'ecran ne protegeait rien.
//
// Le test emprunte le chemin de l'application (PostgREST + un vrai jeton), jamais l'API
// Management qui s'execute en `postgres` et repondrait toujours oui : c'est exactement l'erreur
// qui avait laisse passer la regression du cockpit le 09/09.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY, ANON = env.SUPABASE_ANON_KEY;
if (!SB || !KEY || !ANON) { console.log("Secrets absents — test ignore."); process.exit(0); }

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? "\n       " + detail : ""}`); }
};
const admin = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Un vrai jeton, comme celui du navigateur. On passe par le compte de test de Fouka
// (prenom « c ») : jamais par celui d'une recrue, dont le lien d'invitation serait invalide.
async function jetonDe(filtre) {
  const p = await (await fetch(`${SB}/rest/v1/profiles?select=id,prenom,nom&${filtre}&limit=1`, { headers: admin })).json();
  if (!Array.isArray(p) || !p.length) return null;
  const { email } = await (await fetch(`${SB}/auth/v1/admin/users/${p[0].id}`, { headers: admin })).json();
  const { action_link } = await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { ...admin, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  })).json();
  const loc = (await fetch(action_link, { redirect: "manual" })).headers.get("location") || "";
  const tok = (loc.match(/access_token=([^&]+)/) || [])[1];
  return tok ? { tok, id: p[0].id, qui: `${p[0].prenom} ${p[0].nom}` } : null;
}
const api = (chemin, tok) => fetch(`${SB}/rest/v1/${chemin}`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });

const photo = await jetonDe("role=eq.photo&prenom=eq.c");
if (!photo) { console.log("Compte photographe de test introuvable — test ignore."); process.exit(0); }
console.log(`\nPhotographe incarne : ${photo.qui}`);

// ── 1. profiles ne porte plus d'adresse ─────────────────────────────────────
const r1 = await api("profiles?select=id,prenom,nom,adresse,code_postal", photo.tok);
const d1 = await r1.json();
const fuites = Array.isArray(d1)
  ? d1.filter((p) => p.id !== photo.id && ((p.adresse || "").trim() || (p.code_postal || "").trim()))
  : [];
t("aucune adresse de collegue lisible via profiles", fuites.length === 0,
  fuites.map((p) => `${p.prenom} ${p.nom} — ${p.adresse || ""} ${p.code_postal || ""}`).join("\n       "));

// ── 2. la nouvelle table est fermee aux collegues ───────────────────────────
const r2 = await api("collaborateur_coordonnees?select=collaborateur_id,adresse,code_postal", photo.tok);
const d2 = await r2.json();
const autres = Array.isArray(d2) ? d2.filter((c) => c.collaborateur_id !== photo.id) : [];
t("un photographe ne lit aucune coordonnee d'un collegue",
  r2.status === 200 ? autres.length === 0 : [401, 403].includes(r2.status),
  `HTTP ${r2.status} — ${autres.length} ligne(s) d'autrui`);

// ── 3. il garde acces aux siennes ───────────────────────────────────────────
const r3 = await api(`collaborateur_coordonnees?select=adresse&collaborateur_id=eq.${photo.id}`, photo.tok);
t("il lit toujours sa propre fiche sans erreur", r3.status === 200, `HTTP ${r3.status}`);

// ── 4. et il ne peut pas ecrire chez un collegue ────────────────────────────
const cible = Array.isArray(d1) ? (d1.find((p) => p.id !== photo.id) || {}).id : null;
if (cible) {
  const r4 = await fetch(`${SB}/rest/v1/collaborateur_coordonnees`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${photo.tok}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ collaborateur_id: cible, adresse: "ZZ intrusion" }),
  });
  t("il ne peut pas ecrire l'adresse d'un collegue", r4.status >= 400, `HTTP ${r4.status}`);
}

// ── 5. l'administration, elle, doit continuer a voir ────────────────────────
const adm = await jetonDe("role=eq.admin");
if (adm) {
  const r5 = await api("collaborateur_coordonnees?select=collaborateur_id,adresse", adm.tok);
  const d5 = await r5.json();
  t("l'administration lit toujours les coordonnees", r5.status === 200 && Array.isArray(d5) && d5.length > 0,
    `HTTP ${r5.status} — ${Array.isArray(d5) ? d5.length : 0} ligne(s)`);
  // La fiche collaborateur de l'OS lit profiles?select=* : elle doit rester servie.
  const r6 = await api("profiles?select=*&limit=1", adm.tok);
  t("profiles?select=* repond encore (fiche collaborateur de l'OS)", r6.status === 200, `HTTP ${r6.status}`);
}

// ── 6. l'annuaire reste utilisable ──────────────────────────────────────────
const r7 = await api("profiles?select=id,prenom,nom,role,email,telephone,avatar_url,ville,vehicule,permis,bio&order=nom.asc", photo.tok);
const d7 = await r7.json();
t("l'annuaire interne repond toujours au photographe",
  r7.status === 200 && Array.isArray(d7) && d7.length > 1, `HTTP ${r7.status} — ${Array.isArray(d7) ? d7.length : 0} ligne(s)`);

console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
