// L'hydratation de Club+ : le HTML rendu par le serveur et le premier rendu du navigateur doivent
// être strictement identiques.
//
// ── Pourquoi ce test existe ──
// Le 08/09/2026, TOUTES les pages Club+ levaient l'erreur React #425. La cause tenait en une
// ligne : VersionBadge formatait l'horodatage du build avec `toLocaleString` sans `timeZone`. Le
// serveur Netlify tourne en UTC, le navigateur en Europe/Paris. Le serveur écrivait « 14:18 », le
// client « 16:18 ».
//
// Ce n'était pas cosmétique : React, constatant la divergence, JETAIT tout le document rendu par
// le serveur et le reconstruisait côté client — « The server HTML was replaced with client content
// in #document ». C'est précisément le mécanisme qui fait apparaître puis disparaître des éléments
// pendant une fraction de seconde, et qui peut montrer brièvement une interface qui n'est pas
// celle du rôle connecté.
//
// ── Pourquoi le fuseau du serveur est forcé à UTC ici ──
// En local, serveur et navigateur partagent le fuseau de la machine : le défaut est INVISIBLE.
// Il n'apparaît qu'en production. Lancer le serveur de développement en UTC reproduit exactement
// les conditions de Netlify, et rend le test capable de détecter la régression avant le déploiement.
//
// ── Comment le lancer ──
//   SV_TEST_EMAIL=... SV_TEST_PASSWORD=... node tests/clubplus-hydratation.test.mjs
// Les identifiants sont nécessaires : VersionBadge vit dans la coquille authentifiée, une page
// publique ne le rend pas. Sans eux, le test s'arrête en le disant, plutôt que d'échouer en
// laissant croire à un défaut.

import { spawn } from "node:child_process";
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";

const APP = new URL("../../SportVision-Connect/app-next/", import.meta.url).pathname;
const PORT = 3319;
const BASE = `http://localhost:${PORT}/clubplus`;
const PAGES = ["dashboard", "calendar", "teams", "settings/organization", "requests"];

const email = process.env.SV_TEST_EMAIL;
const motDePasse = process.env.SV_TEST_PASSWORD;
if (!email || !motDePasse) {
  console.log("Test ignoré : SV_TEST_EMAIL et SV_TEST_PASSWORD sont nécessaires (la coquille testée est authentifiée).");
  process.exit(0);
}

const env = { ...process.env, TZ: "UTC" };
const serveur = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: APP, env, stdio: "pipe" });
let sortie = "";
serveur.stdout.on("data", (d) => (sortie += d));
serveur.stderr.on("data", (d) => (sortie += d));

function arreter(code) {
  try { serveur.kill("SIGTERM"); } catch { /* déjà mort */ }
  process.exit(code);
}

async function attendreLeServeur(essais = 60) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(`${BASE}/auth/login`);
      if (r.ok) return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

if (!(await attendreLeServeur())) {
  console.error("Le serveur de développement n'a pas démarré :\n" + sortie.slice(-800));
  arreter(1);
}

// Session obtenue par l'API, puis déposée telle quelle en cookie : exactement ce que fait le
// navigateur après une connexion, sans dépendre du formulaire.
const urlSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const cleAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const reponse = await fetch(`${urlSupabase}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: cleAnon, "content-type": "application/json" },
  body: JSON.stringify({ email, password: motDePasse }),
});
const session = await reponse.json();
if (!session.access_token) {
  console.error("Connexion impossible avec les identifiants fournis.");
  arreter(1);
}
const nomCookie = `sb-${new URL(urlSupabase).hostname.split(".")[0]}-auth-token`;
const valeurCookie = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");

const navigateur = await chromium.launch();
let echecs = 0;

for (const chemin of PAGES) {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  await contexte.addCookies([{ name: nomCookie, value: valeurCookie, domain: "localhost", path: "/" }]);
  const page = await contexte.newPage();

  const divergences = [];
  page.on("console", (m) => {
    const t = m.text();
    // Les deux formulations de React : le texte qui diffère, et le document reconstruit.
    if (/did not match|hydrat|server html was replaced/i.test(t)) divergences.push(t.split("\n")[0]);
  });
  page.on("pageerror", (e) => {
    if (/#(418|423|425)|hydrat/i.test(e.message)) divergences.push(e.message.split("\n")[0]);
  });

  await page.goto(`${BASE}/${chemin}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  if (divergences.length === 0) {
    console.log(`  ok   /${chemin}`);
  } else {
    echecs++;
    console.log(`  KO   /${chemin} — ${divergences[0].slice(0, 160)}`);
  }
  await contexte.close();
}

await navigateur.close();
console.log(echecs === 0
  ? `\n${PAGES.length}/${PAGES.length} — aucune divergence entre le rendu serveur et le rendu client.`
  : `\n${echecs} page(s) avec une hydratation incohérente.`);
arreter(echecs === 0 ? 0 : 1);
