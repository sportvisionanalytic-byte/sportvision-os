// La generation des depenses recurrentes doit repondre par le CHEMIN REEL de l'application.
//
// REGRESSION DU 09/09/2026, trouvee le 10/09. migration-audit-v1-fonctions-internes.sql a
// revoque EXECUTE sur `fin_generer_depenses_recurrentes` en la croyant appelee seulement par un
// cron ou par une fonction SECURITY DEFINER. C'est faux : l'ecran Finance > Depenses de l'OS
// l'appelle directement, a chaque ouverture (en silence, `catch(e){}`) et par son bouton. Aucun
// cron ne l'appelle, et elle ne pourrait pas l'etre : elle exige auth.uid() admin ou compta.
//
// Consequence : le 05/10/2026, les onze abonnements mensuels ne se seraient pas generes, sans
// aucun message. Meme famille que le cockpit Production (api-cockpit-production.test.mjs).
//
// Le test appelle vraiment la fonction. Elle est idempotente (index unique source+periode) et
// ne cree que les echeances deja dues : exactement ce que fait l'ouverture de l'ecran.

const env = Object.fromEntries(
  (await import("node:fs")).readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY, ANON = env.SUPABASE_ANON_KEY;
if (!SB || !KEY || !ANON) { console.log("Secrets absents — test ignore."); process.exit(0); }

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

const admin = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function jetonPour(role) {
  const r = await fetch(`${SB}/rest/v1/profiles?select=id&role=eq.${role}&actif=is.true&limit=1`, { headers: admin });
  const p = await r.json();
  if (!Array.isArray(p) || !p.length) return null;
  const email = (await (await fetch(`${SB}/auth/v1/admin/users/${p[0].id}`, { headers: admin })).json()).email;
  const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { ...admin, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  })).json()).action_link;
  const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
  return { email, tok: (loc.match(/access_token=([^&]+)/) || [])[1] };
}
const rpc = (jeton) => fetch(`${SB}/rest/v1/rpc/fin_generer_depenses_recurrentes`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
  body: "{}",
});

const compta = (await jetonPour("compta")) || (await jetonPour("admin"));
if (!compta?.tok) { console.log("Aucun jeton compta/admin obtenu — test ignore."); process.exit(0); }

console.log(`\n1. L'ecran Depenses peut generer les echeances (${compta.email})`);
const r1 = await rpc(compta.tok);
const d1 = await r1.json();
t("la fonction repond 200 a un compte compta/admin", r1.status === 200, `HTTP ${r1.status} — ${JSON.stringify(d1).slice(0, 140)}`);
t("elle renvoie une liste (vide si rien n'est du)", Array.isArray(d1));

console.log("\n2. Ce que l'audit fermait reste ferme");
const r2 = await rpc(null);
t("un anonyme ne peut pas l'appeler", r2.status === 401 || r2.status === 403, `HTTP ${r2.status}`);

const photo = await jetonPour("photo");
if (photo?.tok) {
  const r3 = await rpc(photo.tok);
  const d3 = await r3.text();
  t("un photographe est refuse par la fonction elle-meme", r3.status >= 400 && /Acc[eè]s refus/.test(d3), `HTTP ${r3.status} — ${d3.slice(0, 120)}`);
}

console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
