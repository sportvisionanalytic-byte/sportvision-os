// Hydratation et responsive de Club+, sur le site DEPLOYE.
//
// POURQUOI UN SECOND TEST D'HYDRATATION. clubplus-hydratation.test.mjs compare le HTML du serveur
// au premier rendu du navigateur, mais il exige un serveur de developpement lance en UTC : c'est
// un garde-fou AVANT deploiement. Il ne dit rien de ce qui est en ligne. Or le defaut d'origine
// (React #425 sur toutes les pages, le 08/09/2026) n'etait visible qu'en production, parce qu'en
// local serveur et navigateur partagent le fuseau de la machine.
//
// Celui-ci mesure donc le site tel qu'il est servi, dans le fuseau ou vit vraiment le probleme :
// navigateur en Europe/Paris, serveur Netlify en UTC. Il regarde trois choses qu'un rechargement
// direct fait apparaitre et qu'une navigation interne masque :
//   • une erreur d'hydratation React, meme silencieuse pour l'oeil ;
//   • un ecran qui deborde horizontalement a 390, 768 ou 1440 px ;
//   • un « flash » de role — l'espace d'un autre role affiche une fraction de seconde.
//
// Le troisieme est le plus grave et le plus difficile a voir a l'oeil nu : c'est exactement ce que
// produit React quand il jette le document du serveur pour le reconstruire.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { cookiesDeSession, CP } from "./_session-clubplus.mjs";
import { rapporteur } from "./_session-os.mjs";

const CM = "chris2brazza@gmail.com";
const CLUB = "SF Villemomble";
const { t, bilan } = rapporteur();

// Les pages qu'un CM ouvre vraiment, y compris les plus lourdes.
const PAGES = ["/clubplus/dashboard", "/clubplus/calendar", "/clubplus/matchcenter",
               "/clubplus/teams", "/clubplus/presences", "/clubplus/users"];
const LARGEURS = [["telephone", 390], ["tablette", 768], ["bureau", 1440]];

// Les messages qui trahissent une hydratation ratee. Le premier est explicite, les suivants sont
// les numeros d'erreur React en production, ou le texte est minifie.
const HYDRATATION = /server HTML was replaced|Hydration failed|did not match|Minified React error #(418|419|422|423|425)/i;

const navigateur = await chromium.launch();
const cookies = await cookiesDeSession(CM);

let echecsHydratation = [];
let debordements = [];
let flashs = [];

for (const [nomLargeur, largeur] of LARGEURS) {
  // Fuseau du navigateur explicite : c'est l'ecart avec l'UTC du serveur qui revele le defaut.
  const ctx = await navigateur.newContext({
    viewport: { width: largeur, height: 900 },
    timezoneId: "Europe/Paris",
    locale: "fr-FR",
  });
  await ctx.addCookies(cookies);

  for (const chemin of PAGES) {
    const page = await ctx.newPage();
    const messages = [];
    page.on("pageerror", (e) => messages.push(String(e)));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) messages.push(m.text()); });

    // Rechargement DIRECT sur l'URL : c'est la seule facon de mesurer l'hydratation. Une navigation
    // interne rend la page cote client, sans HTML serveur a comparer, et ne montrerait rien.
    await page.goto(CP + chemin, { waitUntil: "domcontentloaded" });

    // Le flash de role se joue dans les toutes premieres centaines de millisecondes.
    const debut = await page.evaluate(() => document.body.innerText || "").catch(() => "");
    await page.waitForTimeout(6000);
    const fin = (await page.evaluate(() => document.body.innerText || "").catch(() => "")) || "";

    const rates = messages.filter((m) => HYDRATATION.test(m));
    if (rates.length) echecsHydratation.push(`${chemin} a ${largeur}px : ${rates[0].slice(0, 120)}`);

    const deborde = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    if (deborde) {
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      debordements.push(`${chemin} a ${largeur}px (contenu ${sw}px)`);
    }

    // Un flash d'espace, c'est le club ACTIF qui change entre le premier rendu et l'etat stabilise.
    //
    // Une premiere version comparait les deux textes de page entiers et signalait un flash sur
    // quatre ecrans. C'etait faux : le CM gere DEUX clubs, l'ecran d'entree est le selecteur
    // « Mes clubs SportVision » qui les nomme tous les deux, et il ne bougeait pas d'un
    // millimetre entre 0 et 7000 ms. Le detecteur voyait deux noms dans les deux textes et criait.
    // On lit donc le club ACTIF, celui de l'en-tete, et on ne compare que lui.
    const clubActif = (txt) => {
      if (/Mes clubs SportVision/.test(txt)) return null;   // selecteur : aucun club actif
      for (const nom of ["SF Villemomble", "Villeneuve 340 SC"]) if (txt.includes(nom)) return nom;
      return null;
    };
    const avant = clubActif(debut), apres = clubActif(fin);
    if (avant && apres && avant !== apres) {
      flashs.push(`${chemin} a ${largeur}px : « ${avant} » s'affiche avant « ${apres} »`);
    }

    await page.close();
  }
  await ctx.close();
}

const total = PAGES.length * LARGEURS.length;
t(`aucune erreur d'hydratation sur les ${total} chargements`, echecsHydratation.length === 0,
  echecsHydratation.slice(0, 5).join("\n       "));
t(`aucun debordement horizontal sur les ${total} chargements`, debordements.length === 0,
  debordements.slice(0, 6).join("\n       "));
t("aucun flash d'un autre espace au premier rendu", flashs.length === 0, flashs.slice(0, 4).join("\n       "));

// ── Le meme parcours, mais par navigation interne ───────────────────────────
// Un rechargement direct et une navigation interne n'empruntent pas le meme chemin : le premier
// hydrate, le second rend cote client. Les deux doivent aboutir au meme ecran.
const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Paris", locale: "fr-FR" });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
const messages = [];
page.on("pageerror", (e) => messages.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") messages.push(m.text()); });

await page.goto(`${CP}/clubplus/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
const assistant = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
if (await assistant.count()) {
  await assistant.locator("button", { hasText: "Terminer plus tard" }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);
}

const vides = [];
for (const libelle of ["Calendrier", "Équipes", "Présences", "Messagerie"]) {
  const lien = page.locator("nav a, aside a").filter({ hasText: libelle }).first();
  if (!(await lien.count())) continue;
  await lien.click().catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const texte = (await page.evaluate(() => document.body.innerText)) || "";
  if (texte.replace(/\s+/g, " ").length < 400) vides.push(libelle);
}
t("la navigation interne ne laisse aucun ecran vide", vides.length === 0, vides.join(", "));
t("aucune erreur JavaScript en navigation interne",
  messages.filter((m) => !/favicon|status of 40[34]/i.test(m)).length === 0,
  messages.filter((m) => !/favicon|status of 40[34]/i.test(m)).slice(0, 3).join("\n       "));

await navigateur.close();
console.log(`\n       ${total} chargements directs mesures, en 390 / 768 / 1440 px, navigateur en Europe/Paris.`);
process.exit(bilan() ? 1 : 0);
