// La Finance du Responsable Production, de bout en bout dans l'OS déployé (11/09/2026).
//
//   node tests/os-finance-production-parcours.test.mjs
//
// Vrai navigateur, vrais clics, sur le pôle Basket (sans Production réelle) et une mission fictive
// « ZZ ». Parcourt : la Production lit « Mes finances » (quatre blocs, détail ligne par ligne),
// demande plus que la grille sur sa propre ligne (la demande part en validation Admin), l'Admin
// approuve depuis « Finance Production », la comptabilité calcule, valide et règle le mois, la
// Production le voit payé. La base est relue après chaque clic. Comptes qa-sv-…@example.invalid,
// aucune vraie personne notifiée ; tout est supprimé à la fin, règles du pôle comprises.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS, vraiesErreurs } from "./_session-os.mjs";
const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const r = []; const t = (n, ok, d = "") => r.push(`${ok ? "ok  " : "KO  "} ${n}${d ? "  · " + d : ""}`);
const attendre = (ms) => new Promise((res) => setTimeout(res, ms));
const stamp = Date.now(); const users = []; const ids = {};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function persona(role, niveau = null) {
  const email = `qa-sv-finprod-${role}-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: `Qa!${stamp}x${Math.random()}`, email_confirm: true }) })).json();
  users.push(u.id);
  await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: `FinProd ${role}`, role, actif: true, niveau_operateur: niveau });
  return { id: u.id, email, role, prenom: "QA" };
}
async function confirmer(page) {
  const b = page.locator("#sv-confirm-oui");
  await b.waitFor({ timeout: 8000 }); await b.click(); await attendre(2500);
}
async function choisirPole(page, poleId) {
  await page.locator("#fp-pole").selectOption(poleId); await attendre(3500);
}

const nav = await chromium.launch();
try {
  // ── Décor ──
  const basket = (await svc("GET", "poles?select=id&nom=eq.Basket"))[0].id; ids.pole = basket;
  const deja = await svc("GET", `production_remuneration_config?select=pole_id&pole_id=eq.${basket}`);
  if (deja.length) throw new Error("des règles existent déjà pour le pôle Basket : arrêt, rien n'est écrasé");
  const prods = await svc("GET", `pole_affectations?select=user_id,profiles!pole_affectations_user_id_fkey(role)&pole_id=eq.${basket}&actif=eq.true`);
  if (prods.some((p) => p.profiles?.role === "prod")) throw new Error("le pôle Basket a une Production réelle : arrêt");
  const prod = await persona("prod", 3), admin = await persona("admin"), compta = await persona("compta");
  await svc("POST", "pole_affectations", { pole_id: basket, user_id: prod.id, role_pole: "membre", actif: true });
  await svc("POST", "production_remuneration_config", { pole_id: basket, responsable_production_id: prod.id, coordination_montant: 10, ventes_familles: ["ponctuelles"], ventes_taux_pct: 5 });
  ids.config = true;
  const cli = (await svc("POST", "clients", { nom: `ZZ Club FinProd ${stamp}`, statut_relation: "partenaire", pole_id: basket }))[0]; ids.cli = cli.id;
  const auj = new Date(); const debutMois = new Date(auj.getFullYear(), auj.getMonth(), 1);
  const j1 = iso(debutMois), j2 = iso(new Date(auj.getFullYear(), auj.getMonth() + 1, 0));
  const m1 = (await svc("POST", "prestations", { client_id: cli.id, pole_id: basket, date_prestation: j1, heure_debut: "09:30", lieu: "Stade ZZ", type_prestation: "match", statut: "livrée", source: "interne", responsable_prod_id: prod.id, equipes: "ZZ U13", format_mission: "standard" }))[0];
  const m2 = (await svc("POST", "prestations", { client_id: cli.id, pole_id: basket, date_prestation: j2, heure_debut: "10:00", lieu: "Stade ZZ", type_prestation: "match", statut: "planifiée", source: "interne", responsable_prod_id: prod.id, equipes: "ZZ U15", format_mission: "standard" }))[0];
  ids.m = [m1.id, m2.id];
  const [e1] = await svc("POST", "prestations_equipe", { prestation_id: m1.id, collaborateur_id: prod.id, statut: "acceptée", remuneration: 55, montant_recommande: 55 });
  const [e2] = await svc("POST", "prestations_equipe", { prestation_id: m2.id, collaborateur_id: prod.id, statut: "acceptée", remuneration: 55, montant_recommande: 55 });
  ids.e = [e1.id, e2.id];
  await svc("POST", "paiements", { client_id: cli.id, prestation_id: m1.id, type_paiement: "totalite", montant: 120, statut: "reussi" });

  // ── 1. La Production lit « Mes finances » ──
  let O = await ouvrirOS(nav, prod); let page = O.page;
  t("Production : « Mes finances » est dans son menu", (await page.locator("text=Mes finances").count()) > 0);
  await page.evaluate(() => window.switchView("mesfinances")); await attendre(5000);
  let txt = (await page.locator("#mf-real").innerText()).replace(/\s+/g, " ");
  t("les quatre blocs, séparés", /Fixe \/ forfait/.test(txt) && /Prime coordination/.test(txt) && /Missions terrain/.test(txt) && /Prime ventes/.test(txt) && /Frais remboursables/.test(txt));
  t("coordination : 20 € pour 2 missions × 10 €", /Prime coordination 20 € 2 missions × 10 €/.test(txt), (txt.match(/Prime coordination.{0,40}/) || [""])[0]);
  t("terrain : 110 € pour 2 missions", /Missions terrain 110 € 2 missions/.test(txt), (txt.match(/Missions terrain.{0,30}/) || [""])[0]);
  t("prime ventes : 5 € = 5 % de 100 € HT", /Prime ventes 5 € 5 % de 100 € HT/.test(txt), (txt.match(/Prime ventes.{0,40}/) || [""])[0]);
  t("total prévisionnel 135 €, mis en avant", /Total prévisionnel 135 €/.test(txt) && (await page.locator(".mf-kpi.total").count()) === 1, (txt.match(/Total prévisionnel.{0,15}/) || [""])[0]);
  t("état du paiement : acquis, validé, payé, restant à payer", /Acquis .*Validé .*Payé .*Restant à payer/.test(txt));
  t("détail mission : coordination 10 € et terrain 55 € sur la même ligne, acquise", /ZZ U13.* 10 € 55 € .*Acquis/.test(txt), (txt.match(/ZZ U13.{0,60}/) || [""])[0]);
  t("prime ventes : le calcul résumé puis les ventes, « Pris en compte »", /CA encaissé éligible 100 € HT/.test(txt) && /Prime calculée 5 €/.test(txt) && /Pris en compte/.test(txt));
  await page.locator("tr.mf-clic", { hasText: "ZZ U13" }).click(); await attendre(2500);
  t("une mission se clique et ouvre sa fiche", (await page.locator("text=SV-2026").count()) > 1 && (await page.locator(".modal, [role=dialog], #modal-bg.on, .mo.on").count()) > 0);
  await page.keyboard.press("Escape"); await attendre(500);
  await page.setViewportSize({ width: 390, height: 844 }); await attendre(1200);
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  t("mobile 390 px : pas de défilement horizontal de la page", !deborde);
  if (process.env.CAPTURE) await page.screenshot({ path: `${process.env.CAPTURE}-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 }); await attendre(800);

  // ── 2. Elle se demande 150 € au lieu de 55 € sur la mission du 30 ──
  await page.evaluate(([e, p]) => window.modifierRemunerationMembre(e, p, "ZZ", 55, 55, "acceptée", true), [e2.id, m2.id]); await attendre(800);
  t("la fenêtre prévient : c'est votre propre rémunération", (await page.locator("text=C'est votre propre rémunération").count()) > 0);
  await page.locator("#rm-montant").fill("150"); await page.locator("#rm-montant").dispatchEvent("input"); await attendre(300);
  await page.locator("#rm-motif").selectOption("urgence");
  await page.locator('[data-rm="valider"]').click(); await attendre(2500);
  t("écran : « Demande envoyée à l'Admin »", (await page.locator("text=Demande envoyée à l'Admin").count()) > 0);
  let b = (await sql(`select remuneration::text rem, exception_statut st, exception_montant::text dem from prestations_equipe where id='${e2.id}'`))[0];
  t("base : 55 € retenus, 150 € en attente Admin", b.rem === "55.00" && b.st === "a_valider" && Number(b.dem) === 150, JSON.stringify(b));
  t("Production : aucune erreur JavaScript", vraiesErreurs(O.erreurs).length === 0, vraiesErreurs(O.erreurs).slice(0, 2).join(" | "));
  await page.context().close();

  // ── 3. L'Admin tranche depuis « Finance Production » ──
  O = await ouvrirOS(nav, admin); page = O.page;
  await page.evaluate(() => window.switchView("finprod")); await attendre(4000); await choisirPole(page, basket);
  txt = (await page.locator("#fp-real").innerText()).replace(/\s+/g, " ");
  t("Admin : l'exception est listée, grille 55 € / demandé 150 €", /55 €.*150 €.*Urgence/.test(txt), (txt.match(/Exceptions de rémunération.{0,160}/) || [""])[0]);
  await page.locator("#fp-real button", { hasText: /^Approuver$/ }).first().click(); await confirmer(page);
  b = (await sql(`select remuneration::text rem, exception_statut st from prestations_equipe where id='${e2.id}'`))[0];
  t("base : exception approuvée, 150 € retenus", b.rem === "150.00" && b.st === "approuvee", JSON.stringify(b));
  await page.context().close();

  // ── 4. La comptabilité calcule, valide et règle le mois ──
  O = await ouvrirOS(nav, compta); page = O.page;
  await page.evaluate(() => window.switchView("finprod")); await attendre(4000); await choisirPole(page, basket);
  await page.locator("#fp-real button", { hasText: "Calculer / recalculer" }).click(); await attendre(3500);
  b = (await sql(`select id, total::text, statut from pole_remuneration_calculs where pole_id='${basket}' and responsable_id='${prod.id}' and beneficiaire='responsable_production'`))[0];
  ids.calc = b?.id;
  t("base : calcul du mois = fixe 0 + coordination 10 + ventes 5 = 15 €, à valider", b?.total === "15.00" && b?.statut === "a_valider", JSON.stringify(b));
  await page.locator("#fp-real button", { hasText: /^Valider$/ }).click(); await confirmer(page);
  await page.locator("#fp-real button", { hasText: "Marquer payé" }).click(); await confirmer(page);
  b = (await sql(`select statut, paye_le is not null paye from pole_remuneration_calculs where id='${ids.calc}'`))[0];
  t("base : validé puis payé par la comptabilité", b?.statut === "paye" && b?.paye === true, JSON.stringify(b));
  if (process.env.CAPTURE) await page.screenshot({ path: `${process.env.CAPTURE}-finprod.png`, fullPage: true });
  t("comptabilité : aucune erreur JavaScript", vraiesErreurs(O.erreurs).length === 0, vraiesErreurs(O.erreurs).slice(0, 2).join(" | "));
  await page.context().close();

  // ── 5. La Production le voit payé, et ne peut rien y changer ──
  O = await ouvrirOS(nav, prod); page = O.page;
  await page.evaluate(() => window.switchView("mesfinances")); await attendre(5000);
  txt = (await page.locator("#mf-real").innerText()).replace(/\s+/g, " ");
  t("elle voit 15 € payés, rien de restant", /Payé 15 €/.test(txt) && /Restant à payer 0 €/.test(txt), (txt.match(/Acquis.{0,120}/) || [""])[0]);
  t("sa demande approuvée apparaît au bon montant (terrain 205 €)", /Missions terrain 205 €/.test(txt), (txt.match(/Missions terrain.{0,30}/) || [""])[0]);
  const refus = await page.evaluate(async (id) => {
    const res = await sbFetch("rpc/production_regler_remuneration", { method: "POST", body: { p_calcul_id: id, p_action: "rouvrir" } });
    return sbErr(res) ? "refusé" : "accepté";
  }, ids.calc);
  t("elle tente de rouvrir son propre calcul : refusé", refus === "refusé");
  if (process.env.CAPTURE) await page.screenshot({ path: `${process.env.CAPTURE}-mesfinances.png`, fullPage: true });
  await page.context().close();

  const notifs = (await sql(`select count(*) n from notifications where created_at > now() - interval '30 minutes'
    and destinataire_id not in (${users.map((u) => `'${u}'`).join(",")}) and (prestation_id in ('${m1.id}','${m2.id}') or lien_prestation_id in ('${m1.id}','${m2.id}'))`))[0];
  t("aucune vraie personne notifiée", notifs?.n === 0, JSON.stringify(notifs));
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 220));
} finally {
  await nav.close();
  const u = users.map((x) => `'${x}'`).join(",") || "null";
  const e = (ids.e || []).map((x) => `'${x}'`).join(",") || "null";
  const m = (ids.m || []).map((x) => `'${x}'`).join(",") || "null";
  const net = await sql(`begin;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    delete from activity_log where entity_id in (${e}, ${m}${ids.calc ? `, '${ids.calc}'` : ""}${ids.config ? `, '${ids.pole}'` : ""});
    delete from financial_audit_log where ligne_id in (${e}, ${m}${ids.calc ? `, '${ids.calc}'` : ""}${ids.config ? `, '${ids.pole}'` : ""});
    delete from notifications where destinataire_id in (${u}) or prestation_id in (${m}) or lien_prestation_id in (${m});
    delete from audit_logs where acteur_id in (${u});
    ${ids.calc ? `delete from pole_remuneration_calculs where id = '${ids.calc}';` : ""}
    delete from paiements where client_id = ${ids.cli ? `'${ids.cli}'` : "null"};
    delete from prestations_equipe where id in (${e});
    delete from prestations where id in (${m});
    ${ids.cli ? `delete from clients where id = '${ids.cli}';` : ""}
    ${ids.config ? `delete from production_remuneration_config where pole_id = '${ids.pole}' and responsable_production_id in (${u});` : ""}
    delete from pole_affectations where user_id in (${u});
    delete from profiles where id in (${u});
    delete from auth.users where id in (${u});
    commit;`);
  if (!Array.isArray(net)) t("nettoyage : erreur", false, JSON.stringify(net).slice(0, 200));
  const reste = (await sql(`select (select count(*) from auth.users where email like 'qa-sv-finprod-%-${stamp}@example.invalid') comptes,
    (select count(*) from production_remuneration_config where pole_id = '${ids.pole}') regles_basket,
    (select count(*) from prestations where equipes in ('ZZ U13','ZZ U15') and client_id = ${ids.cli ? `'${ids.cli}'` : "null"}) missions`))[0];
  t("nettoyage complet (comptes, règles du pôle Basket, missions)", Object.values(reste).every((v) => v === 0), JSON.stringify(reste));
  console.log(r.join("\n"));
}
