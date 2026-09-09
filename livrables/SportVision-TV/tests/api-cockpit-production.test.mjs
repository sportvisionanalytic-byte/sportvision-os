// Le cockpit Production doit repondre par le CHEMIN REEL de l'application.
//
// REGRESSION DU 09/09/2026, et c'est elle qui justifie ce fichier. L'audit de securite avait
// revoque EXECUTE sur `mission_cloture_manquant`. La vue `v_production_missions` appelle cette
// fonction : l'ecran s'est mis a renvoyer
//
//   403 — permission denied for function mission_cloture_manquant
//
// Ce que j'avais mal compris : une vue en `security_invoker=off` lit ses TABLES avec les droits
// de son proprietaire, mais l'execution d'une FONCTION appelee dedans reste verifiee contre le
// role APPELANT.
//
// Pourquoi aucun test ne l'a vu : toutes mes verifications passaient par l'API Management, qui
// s'execute en `postgres`. Ce role garde EXECUTE, donc la vue repondait. Le defaut n'existait
// qu'a travers PostgREST, avec un vrai jeton — exactement ce que fait le navigateur.
//
// LECON GENERALE : une revocation de droits se verifie par le chemin que prend l'application,
// jamais en superutilisateur. Ce test emprunte donc ce chemin.

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

// Un vrai jeton, comme celui du navigateur d'un Responsable Production.
const r0 = await fetch(`${SB}/rest/v1/profiles?select=id&role=eq.prod&actif=is.true&limit=1`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
const prods = await r0.json();
if (!Array.isArray(prods) || !prods.length) { console.log("Aucun profil prod actif — test ignore."); process.exit(0); }
const email = (await (await fetch(`${SB}/auth/v1/admin/users/${prods[0].id}`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json()).email;

const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
})).json()).action_link;
const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
const tok = (loc.match(/access_token=([^&]+)/) || [])[1];
if (!tok) { console.log("Jeton non obtenu — test ignore."); process.exit(0); }

const api = (chemin, jeton) =>
  fetch(`${SB}/rest/v1/${chemin}`, { headers: { apikey: ANON, Authorization: `Bearer ${jeton}` } });

console.log(`\n1. Le cockpit repond a un Responsable Production (${email})`);
const r1 = await api("v_production_missions?select=*&groupe=neq.annulees&order=date_prestation.desc", tok);
const d1 = await r1.json();
t("la vue repond 200", r1.status === 200, `HTTP ${r1.status} — ${JSON.stringify(d1).slice(0, 140)}`);
t("elle renvoie bien une liste", Array.isArray(d1));
t("la colonne calculee cloture_manquant est presente",
  !Array.isArray(d1) || d1.length === 0 || "cloture_manquant" in d1[0],
  Array.isArray(d1) && d1[0] ? Object.keys(d1[0]).slice(0, 6).join(",") : "");

console.log("\n2. Le resume de l'accueil Production repond aussi");
const r2 = await api("v_production_missions?select=groupe,date_prestation,livraison_en_retard,echeance_manquante,kit_retour_prevu&groupe=neq.annulees", tok);
t("la requete du resume repond 200", r2.status === 200, `HTTP ${r2.status}`);

console.log("\n3. Ce que l'audit fermait reste ferme");
const r3 = await fetch(`${SB}/rest/v1/rpc/mission_cloture_manquant`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ p_prestation_id: "00000000-0000-0000-0000-000000000000" }),
});
t("un anonyme ne peut pas appeler mission_cloture_manquant", r3.status === 403 || r3.status === 401, `HTTP ${r3.status}`);

const r4 = await fetch(`${SB}/rest/v1/rpc/notifier`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ p_destinataire: prods[0].id, p_categorie: "taches", p_type: "test",
    p_titre: "t", p_message: "m", p_prestation: null, p_priorite: "faible", p_cle: null }),
});
t("un anonyme ne peut toujours pas injecter de notification", r4.status === 403 || r4.status === 401, `HTTP ${r4.status}`);

console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
