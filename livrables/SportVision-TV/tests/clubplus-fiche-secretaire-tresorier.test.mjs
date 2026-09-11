// Secrétaire et Trésorier consultent « Informations du club » : SIRET et annuaire, en lecture seule.
//
// DÉCISION DE FOUKA (11/09/2026). Le SIRET et l'annuaire du club (rôle, nom, téléphone des
// membres) sont réservés à l'Owner Club+, au Président, au CM, à la Secrétaire et au Trésorier
// (migration-club-donnees-restreintes-*). Les deux derniers en avaient le DROIT en base, mais
// aucun écran de leur menu ne le montrait. Ils reçoivent l'entrée « Informations du club »
// (/settings/organization), sans pouvoir rien y modifier.
//
// Le test ouvre Club+ dans un vrai navigateur avec un compte de chaque rôle, sur le club de test
// de Fouka, et vérifie aussi l'envers : un coach n'y a toujours pas accès.
//
//   node livrables/SportVision-TV/tests/clubplus-fiche-secretaire-tresorier.test.mjs
//   LOCAL=http://127.0.0.1:3400 node …   (app locale servie sous l'origine de production)
//
// PROPRETÉ. Comptes zz-…@example.invalid créés par l'API d'administration (aucun e-mail), tout
// supprimé à la fin, suppression vérifiée.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, ANON, enTeteAdmin, rapporteur } from "./_session-os.mjs";

const CP = "https://clubplus.sportvision-an.fr";
const LOCAL = (process.env.LOCAL || "").replace(/\/+$/, "");
const CLUB_NOM = "Villeneuve 340 SC";
const MDP = "ZzFicheClub!2026";
const T0 = Date.now();
const { t, bilan } = rapporteur();

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } });
const lire = async (chemin) => (await api(chemin)).json();
const crees = [];

async function creerMembre(club, role) {
  const email = `zz-fiche-${role}-${T0}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, {
    method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP, email_confirm: true }),
  })).json();
  if (!u?.id) throw new Error(`compte ${role} : ${JSON.stringify(u).slice(0, 160)}`);
  crees.push(u.id);
  const r = await api("club_members", { method: "POST", body: JSON.stringify({ user_id: u.id, club_id: club.id, role, status: "actif", prenom: "ZZ", nom: `Fiche ${role}`, teams: [] }) });
  if (!r.ok) throw new Error(`rattachement ${role} : ${await r.text()}`);
  return { email, id: u.id };
}

// Même principe que clubplus-menus-roles.test.mjs : l'app locale répond sous l'origine de prod.
async function brancherLocal(ctx) {
  if (!LOCAL) return;
  await ctx.route(`${CP}/**`, async (route) => {
    const url = route.request().url().replace(CP, LOCAL);
    const envoyes = { ...route.request().headers() };
    if (envoyes.origin) envoyes.origin = LOCAL;
    try {
      const rep = await route.fetch({ url, headers: envoyes, maxRedirects: 0 });
      const recus = { ...rep.headers() };
      if (recus.location) recus.location = recus.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, CP);
      if (rep.status() >= 300 && rep.status() < 400 && recus.location) {
        const cible = new URL(recus.location, route.request().url()).href;
        delete recus.location; delete recus["content-length"];
        return route.fulfill({ status: 200, headers: { ...recus, "content-type": "text/html; charset=utf-8" }, body: `<!doctype html><script>location.replace(${JSON.stringify(cible)})</script>` });
      }
      await route.fulfill({ response: rep, headers: recus });
    } catch { await route.abort().catch(() => {}); }
  });
}

async function ouvrir(nav, personne) {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  await brancherLocal(ctx);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
  await page.goto(`${CP}/clubplus/auth/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator("input[type=email]").first().fill(personne.email);
  await page.locator("input[type=password]").first().fill(MDP);
  await page.locator("button", { hasText: "Se connecter" }).first().click();
  await page.waitForSelector("aside nav a", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
  return { ctx, page, erreurs };
}
const texte = async (page) => ((await page.evaluate(() => document.body?.innerText || "")) || "").replace(/\s+/g, " ");

const club = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
if (!club) { console.log(`Club ${CLUB_NOM} introuvable — test ignoré.`); process.exit(0); }
const nav = await chromium.launch();
try {
  console.log(`Club+ testé : ${LOCAL ? `app locale ${LOCAL} sous ${CP}` : CP}`);
  for (const role of ["secretaire", "tresorier"]) {
    console.log(`\n${role}`);
    const p = await creerMembre(club, role);
    const { ctx, page, erreurs } = await ouvrir(nav, p);
    const menu = await page.evaluate(() => [...document.querySelectorAll("aside nav a")].map((a) => a.textContent.trim()));
    t(`${role} : « Informations du club » dans le menu`, menu.includes("Informations du club"), menu.join(" | "));
    await page.goto(`${CP}/clubplus/settings/organization`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const tx = await texte(page);
    t(`${role} : la fiche s'ouvre (pas « réservées à l'administrateur »)`, !/réservées à l.administrateur/.test(tx), tx.slice(0, 200));
    t(`${role} : le SIRET est affiché`, /SIRET/.test(tx), tx.slice(0, 300));
    t(`${role} : l'annuaire montre les téléphones`, /Rôle, nom et téléphone/.test(tx), tx.slice(0, 300));
    const champsLibres = await page.locator("main input:not([disabled]):not([type=hidden]), main textarea:not([disabled])").evaluateAll((els) =>
      els.map((e) => `${e.tagName.toLowerCase()}[type=${e.getAttribute("type") || ""}][placeholder=${e.getAttribute("placeholder") || ""}][aria=${e.getAttribute("aria-label") || ""}]`));
    if (champsLibres.length) console.log(`       champs non désactivés : ${champsLibres.join(" ; ")}`);
    const saisissables = champsLibres.length;
    const enregistrer = await page.locator("main button", { hasText: /Enregistrer/ }).count();
    t(`${role} : lecture seule (aucun champ modifiable, aucun « Enregistrer »)`, saisissables === 0 && enregistrer === 0, `champs=${saisissables} boutons=${enregistrer}`);
    t(`${role} : aucune erreur JavaScript`, erreurs.length === 0, erreurs.slice(0, 2).join(" · "));
    await ctx.close();
  }

  console.log("\ncoach (contrôle : toujours sans accès)");
  const coach = await creerMembre(club, "coach");
  const c = await ouvrir(nav, coach);
  const menuCoach = await c.page.evaluate(() => [...document.querySelectorAll("aside nav a")].map((a) => a.textContent.trim()));
  t("coach : pas d'entrée « Informations du club »", !menuCoach.includes("Informations du club"), menuCoach.join(" | "));
  await c.page.goto(`${CP}/clubplus/settings/organization`, { waitUntil: "domcontentloaded" });
  await c.page.waitForTimeout(5000);
  const txc = await texte(c.page);
  t("coach : la fiche lui reste fermée par l'URL directe", /réservées à l.administrateur/.test(txc) && !/Rôle, nom et téléphone/.test(txc), txc.slice(0, 200));
  await c.ctx.close();
} finally {
  await nav.close();
  for (const id of crees) {
    await api(`club_members?user_id=eq.${id}`, { method: "DELETE" });
    await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: enTeteAdmin });
  }
  const restes = await lire(`club_members?select=id&nom=like.Fiche*&prenom=eq.ZZ&club_id=eq.${club?.id}`);
  let comptes = 0;
  for (const id of crees) if ((await (await fetch(`${SB}/auth/v1/admin/users/${id}`, { headers: enTeteAdmin })).json())?.id === id) comptes++;
  t("nettoyage : aucun compte ni rattachement de test ne subsiste", comptes === 0 && Array.isArray(restes) && restes.length === 0, `comptes=${comptes} lignes=${JSON.stringify(restes).slice(0, 80)}`);
}
process.exit(bilan() ? 1 : 0);
