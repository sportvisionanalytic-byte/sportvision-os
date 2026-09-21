// L'opérateur dépose autant de liens qu'il veut, dans l'OS déployé (14/09/2026).
//
//   node livrables/SportVision-TV/tests/os-mission-plusieurs-liens.test.mjs
//
// Demande de Fouka : « sur une mission parfois il y a plusieurs liens a mettre ou pas, faire en
// sorte que les photographes-videastes mettent le nombre de liens qu'ils veulent ».
//
// La base l'acceptait deja ; c'est l'ECRAN qui n'affichait que le premier lien de chaque livrable.
// Ce test regarde donc ce que l'operateur VOIT, sur le vrai OS, avec trois liens photo et un lien
// annexe. Un test SQL n'aurait rien vu : les trois lignes etaient bien en base.
//
// PROPRETE : client et mission fictifs, un compte qa-sv-…@example.invalid, aucun e-mail. Tout est
// supprime a la fin, et verifie.
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
  const email = `qa-sv-liens-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email, password: "QaLiens!2026", email_confirm: true }) })).json();
  ids.users.push(u.id);
  await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: "Liens", role: "photo", actif: true });

  // Le pole se pose sur le CLIENT : un trigger le recopie sur la prestation. Sans lui,
  // prestation_pole_scope_ok repond non et l'operateur recoit un 403 muet en deposant son lien —
  // on mesurerait un refus de perimetre au lieu de l'ecran. Aucune prestation reelle n'est dans
  // ce cas (verifie le 14/09), mais le decor, lui, l'etait.
  const pole = (await sql(`select id from poles order by nom limit 1`))[0];
  await svc("POST", "pole_affectations", { user_id: u.id, pole_id: pole.id, actif: true });
  const client = (await svc("POST", "clients", { nom: `ZZ Liens ${stamp}`, statut: "client", pole_id: pole.id }))[0];
  ids.client = client.id;
  const pres = (await svc("POST", "prestations", { client_id: client.id, reference: `ZZ-LIENS-${stamp}`,
    date_prestation: new Date(Date.now() - 864e5).toISOString().slice(0, 10), statut: "production_terminée", couverture: "photo" }))[0];
  ids.prestation = pres.id;
  await svc("POST", "prestations_equipe", { prestation_id: pres.id, collaborateur_id: u.id,
    fonction: "Photo", remuneration: 60, statut: "acceptée", statut_paiement: "en_attente" });

  // Trois liens photo — le cas de Fouka — et un lien annexe hors livrables attendus.
  for (const [nom, url, cat, tm] of [
    ["Photos — 1re mi-temps", "https://ex.invalid/a", "final", "photo"],
    ["Photos — 2e mi-temps", "https://ex.invalid/b", "final", "photo"],
    ["Photos — podium", "https://ex.invalid/c", "final", "photo"],
    ["Drone — survol du terrain", "https://ex.invalid/d", "livraison", "drone"],
  ]) await svc("POST", "media_liens", { prestation_id: pres.id, nom, url, categorie: cat, type_media: tm,
    statut: "a_verifier", ajouteur_id: u.id, transfert_confirme: true });

  const P = await ouvrirOS(nav, { id: u.id, email, role: "photo", prenom: "QA" });
  const echecsHttp = [];
  P.page.on("response", (r) => { if (r.status() >= 400) echecsHttp.push(`${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, "")}`.slice(0, 140)); });
  await P.page.evaluate((id) => window.modalSauvegarde(id), pres.id);
  await attendre(3500);
  const vu = await P.page.evaluate(() => document.body.innerText);

  // v240 : l'ecran ne s'appelle plus « Livrables attendus », parce qu'il n'attend plus rien.
  t("l'écran des livrables s'ouvre", /Ce que vous livrez/.test(vu));
  for (const nom of ["1re mi-temps", "2e mi-temps", "podium"])
    t(`le lien « ${nom} » est visible`, vu.includes(nom));
  t("l'écran annonce le nombre de liens", /3 liens/.test(vu), (vu.match(/\d+ liens?/) || [""])[0]);
  t("le lien annexe (drone) a sa place", vu.includes("Drone — survol du terrain") && /Autres liens/.test(vu));
  t("un bouton permet d'en ajouter encore un", vu.includes("+ Autre lien") && vu.includes("+ Ajouter un lien"));

  // La modale d'ajout libre s'ouvre et demande ce que contient le lien.
  await P.page.evaluate((id) => window.modalAutreLien(id), pres.id);
  await attendre(900);
  t("la modale « Ajouter un lien » propose un type", (await P.page.locator("#al-type option").count()) >= 6);
  await P.page.fill("#al-url", "https://ex.invalid/e");
  await P.page.click("button:has-text('Enregistrer le lien')");
  await attendre(1200);
  t("elle refuse un lien sans dire ce que c'est",
    (await P.page.locator("#al-err").innerText().catch(() => "")).length > 0);
  await P.page.fill("#al-nom", "Veo — match complet");
  await P.page.click("button:has-text('Enregistrer le lien')");
  await attendre(3000);
  const cinq = (await sql(`select count(*)::int n from media_liens where prestation_id='${pres.id}'`))[0];
  t("le cinquième lien est enregistré", cinq?.n === 5, JSON.stringify(cinq));

  const apres = await P.page.evaluate(() => document.body.innerText);
  t("il apparaît tout de suite à l'écran", apres.includes("Veo — match complet"));

  const boum = vraiesErreurs(P.erreurs);
  t("aucune erreur JavaScript", boum.length === 0, boum.slice(0, 2).join(" | "));
  t("aucune requête en échec", echecsHttp.length === 0, echecsHttp.slice(0, 2).join(" | "));
  await P.page.context().close();
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 200));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  await sql(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
    -- Deposer un lien notifie la Production : sans cette ligne, la cle etrangere de notifications
    -- fait echouer tout le bloc et RIEN n'est supprime (le nettoyage echouait en silence).
    delete from notifications where prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"}
       or lien_prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from media_liens where prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from mission_suivi_operateur where prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from prestations_equipe where prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from prestations where id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from clients where id = ${ids.client ? `'${ids.client}'` : "null"};
    delete from pole_affectations where user_id in (${u});
    delete from profiles where id in (${u}); delete from auth.users where id in (${u}); commit;`);
  const reste = (await sql(`select (select count(*)::int from prestations where reference='ZZ-LIENS-${stamp}') m,
    (select count(*)::int from auth.users where email like 'qa-sv-liens-${stamp}@example.invalid') c`))[0];
  t("nettoyage complet", reste?.m === 0 && reste?.c === 0, JSON.stringify(reste));
  bilan();
}
