// Balayage de tous les ecrans du menu de l'OS, role par role, sur le site DEPLOYE.
//
// POURQUOI. Le 10/09/2026, deux regressions de l'audit de pre-lancement ne se voyaient que dans
// un vrai navigateur, avec un vrai compte : la CSP bloquait les videos du Centre de formation
// (frame-src 'none'), et une revocation de droits rendait la generation des depenses
// recurrentes impossible (echec avale par un catch vide). Aucun test par ecran ne les couvrait,
// parce que personne n'avait pense a ces ecrans-la.
//
// Ce test ne presume rien : il ouvre chaque entree du menu de chaque role interne et releve
// erreurs JavaScript, violations CSP et reponses 4xx/5xx de Supabase. Lecture seule, sauf ce que
// l'ouverture d'un ecran declenche d'elle-meme chez un vrai utilisateur.
//
// Usage : node tests/os-balayage-ecrans.test.mjs [role,role,...]

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { compte, ouvrirOS, rapporteur } from "./_session-os.mjs";

const ROLES = (process.argv[2] || "admin,compta,prod,sec,com,cm,photo").split(",");
const { t, bilan } = rapporteur();
const navigateur = await chromium.launch();

// Bruit connu, qui ne dit rien de l'application.
const bruit = (s) => /favicon|Download the React DevTools|net::ERR_ABORTED|ResizeObserver loop/i.test(s);

async function balayer(role) {
  const personne = await compte(`role=eq.${role}&actif=is.true`);
  if (!personne) return { role, absent: true };
  const { page } = await ouvrirOS(navigateur, personne);
  let courant = "(demarrage)";
  const releve = {};
  const noter = (msg) => { if (!bruit(msg)) (releve[courant] ||= new Set()).add(msg.slice(0, 230)); };
  page.on("pageerror", (e) => noter("JS : " + String(e)));
  page.on("console", (m) => {
    const x = m.text();
    if (/Content Security Policy/i.test(x)) noter("CSP : " + x);
    else if (m.type() === "error" && !/Failed to load resource/i.test(x)) noter("console : " + x);
  });
  page.on("response", async (r) => {
    if (r.status() < 400 || !/supabase\.co|sportvision-an\.fr/.test(r.url())) return;
    let corps = "";
    try { corps = (await r.text()).slice(0, 140); } catch {}
    const u = new URL(r.url());
    noter(`HTTP ${r.status()} ${r.request().method()} ${u.pathname.replace("/rest/v1/", "")}${u.search.slice(0, 60)} ${corps}`);
  });

  const ecrans = await page.evaluate(() =>
    (typeof _navForRole === "function" ? _navForRole(S.role) : []).filter((n) => n && n.id).map((n) => ({ id: n.id, lb: n.lb || n.id })));
  for (const e of ecrans) {
    courant = `${e.id} (${e.lb})`;
    await page.evaluate((id) => window.switchView(id), e.id).catch((err) => noter("switchView : " + err.message));
    await page.waitForTimeout(3500);
  }
  await page.context().close();
  return { role, personne: `${personne.prenom} ${personne.nom}`, n: ecrans.length, releve };
}

const resultats = await Promise.all(ROLES.map((r) => balayer(r).catch((e) => ({ role: r, echec: String(e) }))));
await navigateur.close();

for (const r of resultats) {
  if (r.absent) { console.log(`\n[${r.role}] aucun compte actif, ignore`); continue; }
  if (r.echec) { t(`[${r.role}] le balayage s'execute`, false, r.echec); continue; }
  console.log(`\n[${r.role}] ${r.personne} — ${r.n} ecrans`);
  const fautes = Object.entries(r.releve);
  t(`[${r.role}] aucun ecran en erreur`, fautes.length === 0,
    fautes.map(([ecran, s]) => `${ecran}\n         ${[...s].join("\n         ")}`).join("\n       "));
}
process.exit(bilan() ? 1 : 0);
