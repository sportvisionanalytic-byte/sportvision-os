// Le parcours de l'operateur : deux badges distincts, et une checklist qui suit la couverture.
//
// Deux regles de ce module ne se voient qu'a l'usage, et c'est exactement pour ca qu'elles
// meritent un test :
//
// 1. « Prestation realisee » ne veut PAS dire « Mission terminee ». C'est la confusion que le
//    module existe pour empecher (Fouka, 09/09/2026) : le match est fini, le travail non.
// 2. Une mission photo ne doit jamais parler de montage, une mission video jamais de Lightroom
//    (§43). Une checklist qui demande le mauvais travail est pire qu'une checklist absente.
//
// Le test charge le vrai fichier de l'OS dans un navigateur et interroge les fonctions telles
// qu'elles tournent en production. Aucune base n'est necessaire : ces fonctions sont pures.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((req, res) => {
  if (req.url !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(html);
});
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;

const nav = await chromium.launch();
const page = await nav.newPage();
const erreursJs = [];
page.on("pageerror", (e) => {
  const msg = String(e).split("\n")[0];
  if (/ServiceWorker/i.test(msg)) return;
  erreursJs.push(msg);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof badgesParcours === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};
const badges = (statut) => page.evaluate((s) => badgesParcours({ statut: s }), statut);
const avant = (c) => page.evaluate((x) => checklistAvant(x).map((i) => i.lb).join(" | "), c);
const apres = (c) => page.evaluate((x) => checklistApres(x).map((i) => i.lb).join(" | "), c);

// ── 1. Les deux badges ───────────────────────────────────────────────────────
console.log("\n1. « Prestation realisee » n'est pas « Mission terminee »");

const enRoute = await badges("équipe_en_route");
t("avant le terrain, aucun des deux badges finaux",
  !enRoute.includes("Prestation réalisée") && !enRoute.includes("Mission terminée"), enRoute);

const finTerrain = await badges("production_terminée");
t("fin du terrain : « Prestation realisee » apparait", finTerrain.includes("Prestation réalisée"), finTerrain);
t("fin du terrain : « Mission terminee » N'apparait PAS", !finTerrain.includes("Mission terminée"), finTerrain);

const postprod = await badges("montage_en_cours");
t("en post-production, « Prestation realisee » reste affiche", postprod.includes("Prestation réalisée"), postprod);
t("en post-production, le travail restant est nomme", postprod.includes("Post-production"), postprod);
t("en post-production, toujours pas « Mission terminee »", !postprod.includes("Mission terminée"), postprod);

const livree = await badges("livrée");
t("livree a Production : la mission n'est pas encore terminee",
  !livree.includes("Mission terminée") && livree.includes("Matériel réglé"), livree);

const cloturee = await badges("clôturée");
t("cloturee : les deux badges sont la", cloturee.includes("Prestation réalisée") && cloturee.includes("Mission terminée"), cloturee);

// ── 2. La checklist suit la couverture ──────────────────────────────────────
console.log("\n2. Une mission ne demande jamais le travail d'une autre");

const apPhoto = await apres("photo");
t("photo : Lightroom demande", /trié|traité/i.test(apPhoto), apPhoto);
t("photo : aucun montage demande", !/montage/i.test(apPhoto), apPhoto);
t("photo : aucun rush demande", !/rush/i.test(apPhoto), apPhoto);

const apVideo = await apres("video");
t("video : montage demande", /montage/i.test(apVideo), apVideo);
t("video : rushs demandes", /rush/i.test(apVideo), apVideo);
t("video : aucun traitement photo demande", !/preset du club/i.test(apVideo), apVideo);

const apDeux = await apres("photo_video");
t("photo + video : les deux workflows sont exiges",
  /preset du club/i.test(apDeux) && /montage/i.test(apDeux) && /rush/i.test(apDeux), apDeux);

const avPhoto = await avant("photo");
const avVideo = await avant("video");
t("avant depart : le materiel video n'est demande qu'en video", !/vidéo/i.test(avPhoto) && /vidéo/i.test(avVideo));
t("avant depart : la liste reste courte", (await page.evaluate(() => checklistAvant("photo_video").length)) <= 7);

// ── 3. Les cases portent des actions verifiables (§50) ──────────────────────
console.log("\n3. Aucune case declarative");
const toutes = await page.evaluate(() =>
  [...checklistAvant("photo_video"), ...checklistApres("photo_video")].map((i) => i.lb).join(" | "));
t("aucune case du type « je serai professionnel »", !/professionnel|ponctuel|poli|discret/i.test(toutes), toutes);

// ── 4. Le parcours colle aux transitions autorisees en base ─────────────────
console.log("\n4. Aucun bouton que la base refuserait");
const actions = await page.evaluate(() => Object.entries(OPERATEUR_ACTIONS).map(([de, a]) => de + ">" + a.ns));
// Chaine reelle de validate_prestation_statut_transition, relevee en base le 09/09.
const legales = new Set([
  "équipe_affectée>prête", "prête>équipe_en_route", "équipe_en_route>arrivée_sur_place",
  "arrivée_sur_place>production_démarrée", "production_démarrée>production_terminée",
  "production_terminée>médias_à_transférer", "médias_à_transférer>médias_complets",
]);
const illegales = actions.filter((a) => !legales.has(a));
t("toutes les transitions proposees sont autorisees en base", illegales.length === 0, illegales.join(", "));

// ── 5. Le Guide terrain decrit l'OS reel, pas une procedure parallele ──────
console.log("\n5. Guide terrain");
await page.evaluate(() => {
  document.querySelectorAll("body > *:not(script)").forEach((n) => { n.style.display = "none"; });
  const h = document.createElement("div");
  h.id = "guide-hote";
  h.innerHTML = guideTerrainHtml();
  document.body.appendChild(h);
});
const guide = await page.$eval("#guide-hote", (e) => e.textContent);
t("les 5 règles sont visibles sans ouvrir un chapitre", (await page.evaluate(() => GUIDE_REGLES.length)) === 5);
t("les 8 chapitres sont là", (await page.$$eval("#guide-hote details", (d) => d.length)) === 8);
t("chaque chapitre tient en 3 à 6 règles",
  await page.evaluate(() => GUIDE_CHAPITRES.every((c) => c.r.length >= 3 && c.r.length <= 6)));
t("chaque chapitre a son encart « À retenir »",
  (await page.$$eval("#guide-hote details", (d) => d.filter((x) => /À retenir/.test(x.textContent)).length)) === 8);

// Le point qui compte : le guide doit dire la MEME chose que la base, sinon il devient une
// procedure parallele — exactement ce que Fouka veut eviter.
t("la règle carte SD est énoncée comme en base", /jamais formatée sans confirmation que son contenu est sécurisé/.test(guide));
t("les deux copies sont exigées, pas une", /deux copies avant tout effacement/.test(guide));
t("les rushs sont dits obligatoires, pas optionnels", /rushs sont exigés, pas optionnels/.test(guide));
t("la distinction des deux badges est expliquée",
  /« Prestation réalisée » veut dire que le match est fini/.test(guide) && /« Mission terminée » n’arrive qu’après/.test(guide));
t("l’arrivée 30 à 45 min est rappelée", /30 à 45 minutes/.test(guide));
t("le guide renvoie aux vrais écrans", (await page.$$eval("#guide-hote button[onclick*='switchView']", (b) => b.length)) >= 2);

// §46 : ce guide se lit sur un téléphone.
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => document.querySelectorAll("#guide-hote details").forEach((d) => { d.open = true; }));
const debordGuide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t("aucun débordement horizontal à 390 px", debordGuide <= 0, `${debordGuide} px`);
const petitsGuide = await page.$$eval("#guide-hote button, #guide-hote summary",
  (els) => els.map((e) => ({ t: e.textContent.trim().slice(0, 20), h: e.offsetHeight })).filter((x) => x.h < 40));
t("aucune cible sous 40 px dans le guide", petitsGuide.length === 0, JSON.stringify(petitsGuide));

t("aucune erreur JavaScript pendant tout le test", erreursJs.length === 0, erreursJs.join(" / "));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
