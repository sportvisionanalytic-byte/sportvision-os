// Suppression de comptes : qui peut supprimer qui (décision du 10/09/2026).
//
//   admin-delete-portal-account : appelable par un Admin SportVision actif seulement ; refuse de
//     supprimer un compte collaborateur de l'OS (toute ligne profiles) et l'appelant lui-même.
//   delete-account : refuse un compte collaborateur de l'OS (« s'adresser à l'administration ») ;
//     un compte client garde son droit de se supprimer.
//
// Avant la décision, admin-delete-portal-account supprimait n'importe quel compte — collaborateur,
// autre Admin, l'appelant lui-même — et un collaborateur pouvait supprimer son propre compte par
// delete-account, effaçant son historique.
//
// COMMENT. Les fonctions DEPLOYEES sont appelées par défaut (le « rouge avant » tant que la
// nouvelle version n'est pas en ligne). FONCTION_LOCALE=1 exécute le code du dépôt sous Deno,
// branché sur la vraie base (le « vert après », avant tout déploiement).
//
// REGLES. Comptes zz-os-dec-<objet>-<horodatage>@example.invalid créés par l'API admin (aucun
// e-mail). Aucun vrai compte touché. Tout est supprimé à la fin, suppression vérifiée.
//
//   node livrables/SportVision-TV/tests/os-suppression-comptes.test.mjs
//   FONCTION_LOCALE=1 node livrables/SportVision-TV/tests/os-suppression-comptes.test.mjs

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { env, SB, KEY, ANON, rapporteur } from "./_session-os.mjs";

const LOCAL = process.env.FONCTION_LOCALE === "1";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const RUN = Date.now();
const MOTIF = `zz-os-dec-%-${RUN}@example.invalid`;
const { t, bilan } = rapporteur();
console.log(`Fonctions : ${LOCAL ? "code du depot, execute en local (Deno)" : "versions deployees"}\n`);

async function sql(q) {
  const ref = new URL(SB).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const x = await r.text(); try { return JSON.parse(x); } catch { return x; }
}
const crees = [];
async function jetonDe(action_link) {
  const loc = (await fetch(action_link, { redirect: "manual" })).headers.get("location") || "";
  return new URLSearchParams(loc.split("#")[1] || "").get("access_token");
}
async function suppression(email) {
  await fetch(`${SB}/rest/v1/communication_suppressions`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ channel: "EMAIL", address: email, reason: "manual" }) });
}
// Collaborateur de l'OS : créé comme par invite-collaborateur (profil posé par le déclencheur).
async function collaborateur(objet, role) {
  const email = `zz-os-dec-${objet}-${RUN}@example.invalid`;
  await suppression(email);
  const l = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "invite", email, data: { prenom: "Zoé", nom: "Essai " + objet, role } }) })).json();
  const id = l.id || l.user?.id; crees.push(id);
  return { id, email, jeton: await jetonDe(l.action_link) };
}
// Compte client (Connect) : un compte Auth sans ligne profiles.
async function client(objet) {
  const email = `zz-os-dec-${objet}-${RUN}@example.invalid`;
  await suppression(email);
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, email_confirm: true, user_metadata: { prenom: "Zoé" } }) })).json();
  crees.push(u.id);
  const l = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "magiclink", email }) })).json();
  return { id: u.id, email, jeton: await jetonDe(l.action_link) };
}
const existe = async (id) => (await fetch(`${SB}/auth/v1/admin/users/${id}`, { headers: H })).status === 200;

// Une fonction : déployée, ou lancée depuis le dépôt sous Deno. Pas sur le port 8000 par défaut
// de `serve` : d'autres tests locaux l'occupent (constaté le 10/09 — nos appels tombaient sur une
// fonction Club+ lancée par un autre chantier). Le source du dépôt est passé à Deno par l'entrée
// standard, avec pour SEULE modification le port d'écoute ; aucun fichier temporaire.
const PORT = 18000 + (RUN % 1000);
let deno = null;
async function demarrer(nom) {
  if (!LOCAL) return `${SB}/functions/v1/${nom}`;
  const source = readFileSync(new URL(`../supabase/functions/${nom}/index.ts`, import.meta.url).pathname, "utf8");
  const fin = source.lastIndexOf("});");
  if (fin < 0) throw new Error(nom + " : fin de serve() introuvable");
  const code = source.slice(0, fin) + `}, { port: ${PORT} });` + source.slice(fin + 3);
  deno = spawn("deno", ["run", "--allow-net", "--allow-env", "-"], {
    env: { ...process.env, SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: KEY }, stdio: ["pipe", "ignore", "ignore"],
  });
  deno.stdin.end(code);
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`, { method: "OPTIONS" })).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return `http://localhost:${PORT}/`;
}
function arreter() { if (deno) { deno.kill(); deno = null; } }
async function appeler(url, jeton, corps = {}) {
  const r = await fetch(url, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: "Bearer " + jeton }, body: JSON.stringify(corps) });
  return { status: r.status, corps: await r.json().catch(() => ({})) };
}

try {
  const admin = await collaborateur("admin", "admin");
  const adminOff = await collaborateur("admin-desactive", "admin");
  const photo = await collaborateur("photo", "photo");
  const collegue = await collaborateur("collegue", "sec");
  const collegue2 = await collaborateur("collegue2", "photo");
  const c1 = await client("client1");
  const c2 = await client("client2");
  const c3 = await client("client3");
  for (const x of [admin, adminOff, photo, collegue, collegue2, c1, c2, c3]) if (!x.jeton) throw new Error("jeton absent : " + x.email);
  // Admin désactivé APRÈS l'obtention de son jeton : exactement le cas « jeton encore valable ».
  // Par l'API avec la clé service : le déclencheur protect_sensitive_profile_fields refuse un
  // changement de `actif` à qui n'est ni admin ni service_role (la connexion postgres n'est ni l'un
  // ni l'autre).
  const off = await fetch(`${SB}/rest/v1/profiles?id=eq.${adminOff.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ actif: false }) });
  if (!off.ok || !(await off.json())[0]) throw new Error("desactivation impossible");

  console.log("admin-delete-portal-account");
  let url = await demarrer("admin-delete-portal-account");
  let r = await appeler(url, photo.jeton, { target_user_id: c1.id });
  t("un collaborateur non-admin est refusé", r.status === 403 && await existe(c1.id), `${r.status} ${JSON.stringify(r.corps)}`);
  r = await appeler(url, adminOff.jeton, { target_user_id: c1.id });
  t("un Admin désactivé est refusé (jeton encore valable)", [401, 403].includes(r.status) && await existe(c1.id), `${r.status} ${JSON.stringify(r.corps)}`);
  r = await appeler(url, admin.jeton, { target_user_id: collegue.id });
  t("l'Admin ne supprime pas un collaborateur de l'OS", r.status === 403 && await existe(collegue.id), `${r.status} ${JSON.stringify(r.corps)}`);
  t("… et on lui dit de le désactiver", /désactive/i.test(r.corps.error || ""), r.corps.error);
  r = await appeler(url, admin.jeton, { target_user_id: adminOff.id });
  t("l'Admin ne supprime pas un autre Admin", r.status === 403 && await existe(adminOff.id), `${r.status} ${JSON.stringify(r.corps)}`);
  r = await appeler(url, admin.jeton, { target_user_id: c1.id });
  t("l'Admin supprime toujours un compte client", r.status === 200 && r.corps.deleted === true && !(await existe(c1.id)), `${r.status} ${JSON.stringify(r.corps)}`);
  r = await appeler(url, admin.jeton, { target_user_id: admin.id });
  t("l'Admin ne se supprime pas lui-même", r.status === 403 && await existe(admin.id), `${r.status} ${JSON.stringify(r.corps)}`);
  arreter();

  console.log("\ndelete-account");
  url = await demarrer("delete-account");
  r = await appeler(url, collegue2.jeton);
  t("un collaborateur de l'OS ne supprime pas son propre compte", r.status === 403 && await existe(collegue2.id), `${r.status} ${JSON.stringify(r.corps)}`);
  t("… et on lui dit de s'adresser à l'administration", /administration/i.test(r.corps.error || ""), r.corps.error);
  r = await appeler(url, c2.jeton);
  t("un compte client se supprime toujours lui-même", r.status === 200 && r.corps.deleted === true && !(await existe(c2.id)), `${r.status} ${JSON.stringify(r.corps)}`);
  arreter();
} catch (e) {
  t("le test s'est déroulé jusqu'au bout", false, String(e?.stack || e).slice(0, 400));
} finally {
  arreter();
  for (const id of crees) if (id) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  await sql(`delete from notification_attempts where outbox_id in (select id from notification_outbox where lower(recipient_email) like '${MOTIF}');
    delete from notification_outbox where lower(recipient_email) like '${MOTIF}';
    delete from communication_suppressions where address like '${MOTIF}';`);
  const reste = await sql(`select (select count(*) from auth.users where email like '${MOTIF}') u, (select count(*) from profiles where email like '${MOTIF}') p, (select count(*) from communication_suppressions where address like '${MOTIF}') s`);
  const r0 = Array.isArray(reste) ? reste[0] : {};
  t("nettoyage : aucun compte ni inscription de test ne subsiste", r0.u === 0 && r0.p === 0 && r0.s === 0, JSON.stringify(reste));
  process.exit(bilan() ? 1 : 0);
}
