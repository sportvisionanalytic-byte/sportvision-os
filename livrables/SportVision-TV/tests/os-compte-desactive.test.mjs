// Un compte OS désactivé perd l'API immédiatement, même avec un jeton encore valable.
// Vérifié par le CHEMIN RÉEL : PostgREST, avec un vrai jeton d'accès.
//
// POURQUOI. Désactiver un collaborateur supprime ses sessions (trg_revoquer_sessions_desactive),
// mais le jeton d'accès déjà émis vit encore jusqu'à une heure. Tant que is_staff() et les autres
// contrôles d'identité ne lisaient pas profiles.actif, ce jeton lisait tout comme avant. Même trou
// pour la recrue en intégration : sa session, ouverte par le lien d'invitation pour choisir son mot
// de passe, n'a jamais été « désactivée » (le déclencheur ne réagit qu'au passage true → false).
// Correctif : migration-decisions-os-v1-compte-desactive.sql.
//
// L'API Management s'exécute en postgres et contourne toute policy : elle ne prouverait rien ici.
// On passe donc par /rest/v1 avec le jeton de la personne, exactement comme l'OS.
//
// Rouge tant que la migration n'est pas exécutée en production, vert après.
// Comptes zz-os-dec-<objet>-<horodatage>@example.invalid (lien généré par l'API admin, aucun
// e-mail), supprimés à la fin, suppression vérifiée.
//
//   node livrables/SportVision-TV/tests/os-compte-desactive.test.mjs

import { env, SB, KEY, ANON, rapporteur } from "./_session-os.mjs";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const RUN = Date.now();
const MOTIF = `zz-os-dec-%-${RUN}@example.invalid`;
const { t, bilan } = rapporteur();
const crees = [];

async function sql(q) {
  const ref = new URL(SB).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const x = await r.text(); try { return JSON.parse(x); } catch { return x; }
}
async function inviter(objet, role) {
  const email = `zz-os-dec-${objet}-${RUN}@example.invalid`;
  await fetch(`${SB}/rest/v1/communication_suppressions`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ channel: "EMAIL", address: email, reason: "manual" }) });
  const l = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "invite", email, data: { prenom: "Zoé", nom: "Essai " + objet, role } }) })).json();
  const id = l.id || l.user?.id; crees.push(id);
  return { id, email, lien: l.action_link };
}
async function jeton(lien) {
  const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
  return new URLSearchParams(loc.split("#")[1] || "").get("access_token");
}
// actif par l'API avec la clé service : le déclencheur protect_sensitive_profile_fields réserve ce
// champ à l'admin et au service_role.
async function poserActif(id, actif, extra = {}) {
  const r = await fetch(`${SB}/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ actif, ...extra }) });
  if (!r.ok || !(await r.json())[0]) throw new Error("profil non modifie");
}
// Ce que PostgREST rend au porteur du jeton.
async function mesurer(acces) {
  const h = { apikey: ANON, Authorization: "Bearer " + acces, "Content-Type": "application/json" };
  const lire = async (chemin) => { const r = await fetch(`${SB}/rest/v1/${chemin}`, { headers: h }); const j = await r.json().catch(() => null); return r.ok && Array.isArray(j) ? j.length : `HTTP ${r.status}`; };
  const rpc = async (nom, corps = {}) => { const r = await fetch(`${SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: h, body: JSON.stringify(corps) }); return { status: r.status, corps: await r.json().catch(() => null) }; };
  const grade = await rpc("notifier_grade_valide", { p_collaborateur_id: "00000000-0000-0000-0000-000000000000", p_grade: 1 });
  return {
    clients: await lire("clients?select=id"),
    prestations: await lire("prestations?select=id"),
    profils: await lire("profiles?select=id"),
    poles: await lire("poles?select=id"),
    is_staff: (await rpc("is_staff")).corps,
    clubs: (await rpc("cm_clubs_autorises")).corps?.length ?? "?",
    // Une action réservée à la direction/RH : on regarde le refus, pas l'effet (collaborateur
    // inexistant : rien n'est envoyé).
    action: grade.status,
    action_msg: String(grade.corps?.message || ""),
  };
}

try {
  // ── Collaboratrice RH (lecture transversale : clients, prestations, annuaire) ──
  console.log("Collaboratrice RH : active, puis desactivee avec le meme jeton, puis reactivee");
  const rh = await inviter("rh", "rh");
  const acces = await jeton(rh.lien);
  if (!acces) throw new Error("jeton RH absent");
  const actif = await mesurer(acces);
  console.log("       active     :", JSON.stringify(actif));
  t("active : lit clients, prestations, annuaire, pôles", actif.clients > 0 && actif.prestations > 0 && actif.profils > 1 && actif.poles > 0, JSON.stringify(actif));
  t("active : is_staff() vrai, clubs autorisés, action permise", actif.is_staff === true && actif.clubs > 0 && actif.action === 200, JSON.stringify(actif));

  await poserActif(rh.id, false);
  const off = await mesurer(acces);
  console.log("       desactivee :", JSON.stringify(off));
  t("désactivée, même jeton : plus aucun client", off.clients === 0, `clients=${off.clients}`);
  t("désactivée, même jeton : plus aucune prestation", off.prestations === 0, `prestations=${off.prestations}`);
  t("désactivée, même jeton : plus que son propre profil", off.profils === 1, `profils=${off.profils}`);
  t("désactivée, même jeton : plus les pôles", off.poles === 0, `poles=${off.poles}`);
  t("désactivée, même jeton : is_staff() faux", off.is_staff === false, `is_staff=${off.is_staff}`);
  t("désactivée, même jeton : aucun club autorisé", off.clubs === 0, `clubs=${off.clubs}`);
  t("désactivée, même jeton : l'action est refusée (403)", off.action === 403 && /désactiv/i.test(off.action_msg), `${off.action} ${off.action_msg}`);
  // L'OS lit ce profil à la connexion pour afficher « compte désactivé » : il doit rester lisible.
  const soi = await (await fetch(`${SB}/rest/v1/profiles?id=eq.${rh.id}&select=actif`, { headers: { apikey: ANON, Authorization: "Bearer " + acces } })).json();
  t("désactivée : son propre profil reste lisible (message de connexion)", Array.isArray(soi) && soi[0]?.actif === false, JSON.stringify(soi));

  await poserActif(rh.id, true);
  const re = await mesurer(acces);
  t("réactivée, même jeton : exactement le même accès qu'avant", JSON.stringify(re) === JSON.stringify(actif), `${JSON.stringify(re)} au lieu de ${JSON.stringify(actif)}`);

  // ── Recrue en intégration (actif = false dès la création, session ouverte par son lien) ──
  console.log("\nRecrue en integration : session ouverte par le lien d'invitation, acces ferme");
  const recrue = await inviter("recrue", "rh");
  await poserActif(recrue.id, false, { onboarding_started_at: new Date().toISOString() });
  const accesRecrue = await jeton(recrue.lien);
  if (!accesRecrue) throw new Error("jeton recrue absent");
  const r = await mesurer(accesRecrue);
  console.log("       recrue     :", JSON.stringify(r));
  t("recrue : ne lit ni clients, ni prestations, ni l'annuaire", r.clients === 0 && r.prestations === 0 && r.profils === 1, JSON.stringify(r));
  t("recrue : is_staff() faux, action refusée", r.is_staff === false && r.action === 403, JSON.stringify(r));
} catch (e) {
  t("le test s'est déroulé jusqu'au bout", false, String(e?.stack || e).slice(0, 400));
} finally {
  for (const id of crees) if (id) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  await sql(`delete from notification_attempts where outbox_id in (select id from notification_outbox where lower(recipient_email) like '${MOTIF}');
    delete from notification_outbox where lower(recipient_email) like '${MOTIF}';
    delete from communication_suppressions where address like '${MOTIF}';`);
  const reste = await sql(`select (select count(*) from auth.users where email like '${MOTIF}') u, (select count(*) from profiles where email like '${MOTIF}') p, (select count(*) from communication_suppressions where address like '${MOTIF}') s`);
  const r0 = Array.isArray(reste) ? reste[0] : {};
  t("nettoyage : aucun compte ni inscription de test ne subsiste", r0.u === 0 && r0.p === 0 && r0.s === 0, JSON.stringify(reste));
  process.exit(bilan() ? 1 : 0);
}
