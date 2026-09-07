// La navigation Connect vers Mes galeries, dans un vrai Chromium, en production.
//
// Compte de test avec DEUX commandes sur la MEME galerie : l'accueil et la liste doivent afficher
// UNE galerie, pas deux. C'est le piege du §18.
import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";

const BASE = "https://connect.sportvision-an.fr";
const MAIL = process.env.SV_TEST_MAIL || "zz-nav@sportvision-an.fr";
const MDP = process.env.SV_TEST_MDP || "MotDePasseTest2026!";
const norm = (s) => s.replace(/[   ]/g, " ");

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

for (const [nom, vp] of [["iPhone", { width: 390, height: 844 }], ["Bureau", { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp, isMobile: nom === "iPhone", hasTouch: nom === "iPhone" });
  await p.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await p.locator('input[type="email"]').fill(MAIL);
  await p.locator('input[type="password"]').fill(MDP);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL(/dashboard|particulier/, { timeout: 25000 });
  await p.waitForTimeout(1500);

  const accueil = norm(await p.locator("body").innerText());
  dit(`${nom} : l'accueil montre les dernieres galeries`, /derni[eè]res galeries/i.test(accueil));
  dit(`${nom} : UNE galerie malgre deux commandes`,
      (accueil.match(/Test paiement/g) || []).length === 1,
      `${(accueil.match(/Test paiement/g) || []).length} occurrence(s)`);
  dit(`${nom} : le nombre acquis est affiche`, /2 photos disponibles/.test(accueil),
      accueil.match(/\d+ photos? disponibles?/)?.[0]);

  // L'entree de menu, dans le tiroir sur mobile et dans la sidebar sur bureau.
  if (nom === "iPhone") {
    const menu = p.locator('button[aria-label="Menu de navigation"]').first();
    if (await menu.count()) { await menu.click(); await p.waitForTimeout(700); }
  }
  const lien = p.locator('a[href="/galeries"]:visible').first();
  dit(`${nom} : l'entree « Mes galeries » est visible`, (await p.locator('a[href="/galeries"]:visible').count()) > 0);

  await lien.click();
  await p.waitForURL(/\/galeries/, { timeout: 20000 });
  await p.waitForTimeout(1200);
  const liste = norm(await p.locator("body").innerText());
  dit(`${nom} : la page Mes galeries s'ouvre`, /Mes galeries/.test(liste));
  // On compte les LIENS de galerie, pas les occurrences du titre : celui-ci apparait aussi une
  // fois par commande plus bas, ce qui est justement le comportement voulu (une galerie, deux
  // commandes distinctes). Compter le texte melangeait les deux notions.
  dit(`${nom} : une seule galerie listee`,
      (await p.locator('a[href^="/galeries/"]').count()) === 1,
      `${await p.locator('a[href^="/galeries/"]').count()} lien(s) de galerie`);
  dit(`${nom} : mais bien deux commandes`,
      (await p.locator('a[href^="/gallery/commande/"]').count()) === 2,
      `${await p.locator('a[href^="/gallery/commande/"]').count()} commande(s)`);
  dit(`${nom} : acces permanent annonce`, /Acc[eè]s permanent/i.test(liste));
  dit(`${nom} : les deux commandes restent distinctes`,
      (liste.match(/Test paiement/g) || []).length + (liste.match(/2 €|4 €/g) || []).length >= 2);

  // Entrer dans la galerie, puis revenir : aucun cul-de-sac.
  await p.locator('a[href^="/galeries/"]').first().click();
  await p.waitForURL(/\/galeries\/[0-9a-f-]{36}/, { timeout: 20000 });
  await p.waitForLoadState("networkidle");
  const detail = norm(await p.locator("body").innerText());
  dit(`${nom} : le detail affiche mes photos`, /T[eé]l[eé]charger/.test(detail));
  dit(`${nom} : et le retour vers Mes galeries`, (await p.locator('a[href="/galeries"]').count()) > 0);
  await p.close();
}

await b.close();
console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
