// Les liens deposes par un operateur sont visibles par la Production (14/09/2026).
//
//   node livrables/SportVision-TV/tests/os-livrables-visibles.test.mjs
//
// Fouka : « dans mission je ne vois pas le truc dans livrables alors que mes photographes m'ont dit
// qu'ils ont mis les liens ». Ils les avaient bien mis : SV-2026-0274 portait un « Montage final »
// depose la veille au soir. Mais l'ecran « Livrables par mission » ne listait les missions qu'a
// partir de « prêt_validation », et une mission reste en « médias_à_transférer » tant que
// l'operateur n'a pas clique « Envoyer a Production » — bouton qu'il n'avait meme pas a ce stade,
// et qui de toute facon partait sur une transition que la base refuse.
//
// Trois defauts qui se cachaient l'un l'autre. Ce test les mesure ensemble : un lien depose doit
// se voir, et l'envoi doit aboutir.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS, vraiesErreurs, rapporteur } from "./_session-os.mjs";

const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const { t, bilan } = rapporteur();
const stamp = Date.now();
const ids = { users: [] };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const nav = await chromium.launch();
try {
  const pole = (await sql(`select id from poles order by nom limit 1`))[0];
  const email = `qa-sv-livr-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email, password: "QaLivr!2026", email_confirm: true }) })).json();
  ids.users.push(u.id);
  await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: "Livrables", role: "photo", actif: true });
  await svc("POST", "pole_affectations", { user_id: u.id, pole_id: pole.id, actif: true });

  const client = (await svc("POST", "clients", { nom: `ZZ Livrables ${stamp}`, statut: "client", pole_id: pole.id }))[0];
  ids.client = client.id;
  const REFP = `ZZ-LIVR-${stamp}`;
  const pres = (await svc("POST", "prestations", { client_id: client.id, reference: REFP,
    date_prestation: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    statut: "médias_à_transférer", couverture: "photo" }))[0];
  ids.prestation = pres.id;
  await svc("POST", "prestations_equipe", { prestation_id: pres.id, collaborateur_id: u.id,
    fonction: "Photo", remuneration: 50, statut: "acceptée", statut_paiement: "en_attente" });
  await svc("POST", "media_liens", { prestation_id: pres.id, nom: "Photos traitées", url: "https://ex.invalid/livr",
    categorie: "final", type_media: "photo", statut: "a_verifier", ajouteur_id: u.id, transfert_confirme: true });
  await svc("POST", "mission_suivi_operateur", { prestation_id: pres.id, collaborateur_id: u.id,
    prestation_terminee_at: new Date().toISOString(), fichiers_securises_at: new Date().toISOString() });

  // ── 1. La Production voit la mission et son lien ──
  const admin = (await sql(`select id, email, prenom, role from profiles where role='admin' and actif order by created_at limit 1`))[0];
  const P = await ouvrirOS(nav, admin, { largeur: 1440, hauteur: 900 });
  await P.page.evaluate(() => window.switchView && window.switchView("livraisons"));
  await attendre(4000);
  let vu = await P.page.evaluate(() => document.body.innerText);
  if (!vu.includes(REFP)) {   // l'ecran peut porter un autre nom de vue selon le menu
    await P.page.evaluate(() => window.loadProdLivrMissions && window.loadProdLivrMissions());
    await attendre(3500);
    vu = await P.page.evaluate(() => document.body.innerText);
  }
  t("Production : la mission encore en « médias à transférer » est visible", vu.includes(REFP),
    vu.replace(/\s+/g, " ").slice(0, 120));
  t("Production : le lien déposé y figure", /Photos traitées/.test(vu));
  await P.page.context().close();

  // ── 2. L'opérateur a le bouton, et l'envoi aboutit ──
  const O = await ouvrirOS(nav, { id: u.id, email, role: "photo", prenom: "QA" });
  await O.page.evaluate((id) => window.modalSauvegarde(id), pres.id);
  await attendre(3500);
  const vuOpe = await O.page.evaluate(() => document.body.innerText);
  t("opérateur : le bouton « Envoyer à Production » est proposé", vuOpe.includes("Envoyer à Production"));
  await O.page.evaluate(({ id, st }) => window.envoyerAProduction(id, st), { id: pres.id, st: "médias_à_transférer" });
  await attendre(5000);
  const apres = (await sql(`select statut::text from prestations where id='${pres.id}'`))[0];
  t("l'envoi aboutit jusqu'à « prêt_validation »", apres?.statut === "prêt_validation", JSON.stringify(apres));
  const boum = vraiesErreurs(O.erreurs);
  t("aucune erreur JavaScript", boum.length === 0, boum.slice(0, 2).join(" | "));
  await O.page.context().close();
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 200));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  const pid = ids.prestation ? `'${ids.prestation}'` : "null";
  await sql(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
    delete from notifications where prestation_id = ${pid} or lien_prestation_id = ${pid};
    delete from media_liens where prestation_id = ${pid};
    delete from mission_suivi_operateur where prestation_id = ${pid};
    delete from prestations_equipe where prestation_id = ${pid};
    delete from historique where entite_id = ${pid};
    delete from media_historique where prestation_id = ${pid};
    delete from prestations where id = ${pid};
    delete from clients where id = ${ids.client ? `'${ids.client}'` : "null"};
    delete from pole_affectations where user_id in (${u});
    delete from profiles where id in (${u}); delete from auth.users where id in (${u}); commit;`);
  const reste = (await sql(`select (select count(*)::int from prestations where reference like 'ZZ-LIVR-%') m,
    (select count(*)::int from auth.users where email like 'qa-sv-livr-%@example.invalid') c`))[0];
  t("nettoyage complet", reste?.m === 0 && reste?.c === 0, JSON.stringify(reste));
  bilan();
}
