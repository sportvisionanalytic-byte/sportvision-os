// La Production refuse un travail et retient une pénalité, depuis l'OS déployé (14/09/2026).
//
//   node livrables/SportVision-TV/tests/os-penalite-mission.test.mjs
//
// Demande de Fouka : « le responsable production pouvoir dire mission pas validée, mettre des
// pénalités et retirer sur la paye initiale ». La v231 pose les règles en base et le test SQL
// mission-penalites les mesure une par une. Celui-ci vérifie l'autre moitié : que la Production
// puisse RÉELLEMENT le faire avec sa souris, sur le vrai OS, et qu'elle lise le bon net.
//
// PROPRETÉ : un client fictif, une mission fictive, deux comptes qa-sv-…@example.invalid, aucun
// e-mail (comptes créés par l'API d'administration). Tout est supprimé à la fin, et vérifié.
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

async function personne(tag, role) {
  const email = `qa-sv-penalite-${tag}-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email, password: "QaPenalite!2026", email_confirm: true }) })).json();
  if (!u.id) throw new Error(`compte ${tag} : ${JSON.stringify(u).slice(0, 140)}`);
  ids.users.push(u.id);
  await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: `Penalite ${tag}`, role, actif: true });
  return { id: u.id, email, role, prenom: "QA" };
}

const nav = await chromium.launch();
try {
  // ── Décor : une mission terminée, un opérateur payé 100 € et confirmé ──
  const pole = (await sql(`select id from poles order by nom limit 1`))[0];
  const prod = await personne("prod", "prod");
  const ope = await personne("ope", "photo");
  await svc("POST", "pole_affectations", { user_id: prod.id, pole_id: pole.id, actif: true });
  // L'opérateur aussi : sans affectation de pôle, la RLS de profiles le rend invisible à la
  // Production et l'écran afficherait « ? » à la place de son nom. C'est le cloisonnement par
  // pôle qui parle, pas un défaut de cet écran — mais il fausserait la mesure.
  await svc("POST", "pole_affectations", { user_id: ope.id, pole_id: pole.id, actif: true });
  const client = (await svc("POST", "clients", { nom: `ZZ Penalite ${stamp}`, statut: "client", pole_id: pole.id }))[0];
  ids.client = client.id;
  const pres = (await svc("POST", "prestations", { client_id: client.id, reference: `ZZ-PEN-${stamp}`,
    date_prestation: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), statut: "production_terminée", couverture: "photo" }))[0];
  ids.prestation = pres.id;
  const aff = (await svc("POST", "prestations_equipe", { prestation_id: pres.id, collaborateur_id: ope.id,
    fonction: "Photo", remuneration: 100, statut: "acceptée", statut_paiement: "en_attente" }))[0];
  ids.affectation = aff.id;

  // ── La Production ouvre la mission ──
  const P = await ouvrirOS(nav, prod);
  // Une requête en échec ne dit rien si on ne sait pas laquelle : on retient l'URL.
  const echecsHttp = [];
  P.page.on("response", (r) => { if (r.status() >= 400) echecsHttp.push(`${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, "")}`.slice(0, 150)); });
  await P.page.evaluate(({ id, ref }) => window.modalEquipePrestation(id, ref), { id: pres.id, ref: `ZZ-PEN-${stamp}` });
  await attendre(4000);
  const vu = await P.page.evaluate(() => document.getElementById("eq-liste")?.innerText || "(absent)");
  t("Production : l'équipe de la mission s'affiche", vu.includes("Penalite ope"), vu.replace(/\s+/g, " ").slice(0, 120));
  t("Production : le bouton « Retenir une pénalité » est là", vu.includes("Retenir une pénalité"));
  t("Production : le bouton de verdict est là", vu.includes("Valider ou refuser le travail"));

  // ── Elle refuse le travail ──
  await P.page.evaluate(({ a, p, ref }) => window.modalVerdictMission(a, p, ref, false), { a: aff.id, p: pres.id, ref: `ZZ-PEN-${stamp}` });
  await attendre(800);
  await P.page.fill("#vm-motif", "QA : photos floues sur toute la seconde mi-temps.");
  await P.page.click("#vm-refus");
  await attendre(2500);
  const verdict = (await sql(`select travail_valide, travail_motif from prestations_equipe where id='${aff.id}'`))[0];
  t("le refus est enregistré en base, avec son motif", verdict?.travail_valide === false && /floues/.test(verdict?.travail_motif || ""), JSON.stringify(verdict));

  // ── Elle retient 30 € ──
  await P.page.evaluate(({ a, p, ref }) => window.modalPenaliteMission(a, p, ref, 100, 0), { a: aff.id, p: pres.id, ref: `ZZ-PEN-${stamp}` });
  await attendre(800);
  await P.page.fill("#pm-montant", "30");
  await P.page.fill("#pm-motif", "QA : retard de livraison de 6 jours");
  const avertissement = await P.page.evaluate(() => document.body.innerText.includes("sanction pécuniaire"));
  t("la modale avertit que c'est une sanction pécuniaire", avertissement);
  await P.page.click("#pm-ok");
  await attendre(2500);
  const net = (await sql(`select mission_net_a_payer('${aff.id}') net, (select remuneration from prestations_equipe where id='${aff.id}') brut`))[0];
  t("le net tombe à 70 € et la rémunération acceptée reste 100 €", Number(net?.net) === 70 && Number(net?.brut) === 100, JSON.stringify(net));

  // ── L'opérateur est prévenu, chiffres et motif ──
  const notif = (await sql(`select count(*)::int n from notifications where destinataire_id='${ope.id}'
    and type='mission_penalite' and message like '%30%' and message like '%retard de livraison%' and message like '%70%'`))[0];
  t("l'opérateur est prévenu du montant, du motif et du net", notif?.n === 1, JSON.stringify(notif));

  // ── L'écran affiche le net, pas seulement le brut ──
  await P.page.evaluate(({ id, ref }) => window.chargerEquipe(id, ref), { id: pres.id, ref: `ZZ-PEN-${stamp}` });
  await attendre(3000);
  const apres = await P.page.evaluate(() => document.getElementById("eq-liste")?.innerText || "");
  t("l'écran montre la retenue et le net à payer", /Net à payer/.test(apres) && apres.includes("70") && apres.includes("retard de livraison"),
    apres.replace(/\s+/g, " ").slice(0, 180));
  t("l'écran montre que le travail n'est pas validé", apres.includes("Travail non validé"));

  // ── La clôture est bloquée tant que le travail est refusé ──
  const bloc = (await sql(`select mission_cloture_manquant('${pres.id}')::text m`))[0];
  t("un travail refusé bloque la clôture", /non validé par la Production/.test(bloc?.m || ""), (bloc?.m || "").slice(0, 120));

  const boum = vraiesErreurs(P.erreurs);
  t("aucune erreur JavaScript", boum.length === 0, boum.slice(0, 2).join(" | "));
  t("aucune requête en échec", echecsHttp.length === 0, echecsHttp.slice(0, 3).join(" | "));
  await P.page.context().close();
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 220));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  await sql(`begin;
    select set_config('request.jwt.claims','{"role":"service_role"}',true);
    delete from mission_penalites where affectation_id in (select id from prestations_equipe where prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"});
    delete from notifications where destinataire_id in (${u});
    delete from financial_audit_log where acteur_id in (${u});
    delete from prestations_equipe where prestation_id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from prestations where id = ${ids.prestation ? `'${ids.prestation}'` : "null"};
    delete from clients where id = ${ids.client ? `'${ids.client}'` : "null"};
    delete from pole_affectations where user_id in (${u});
    delete from profiles where id in (${u});
    delete from auth.users where id in (${u});
    commit;`);
  const reste = (await sql(`select (select count(*)::int from auth.users where email like 'qa-sv-penalite-%-${stamp}@example.invalid') comptes,
    (select count(*)::int from prestations where reference = 'ZZ-PEN-${stamp}') missions`))[0];
  t("nettoyage complet", reste?.comptes === 0 && reste?.missions === 0, JSON.stringify(reste));
  bilan();
}
