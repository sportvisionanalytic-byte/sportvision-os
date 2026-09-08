// Le nouveau parcours galerie de l'OS, dans un vrai navigateur.
//
// Ce que Fouka demandait : « Créer galerie → Ajouter photos → Définir les offres → Mettre en
// ligne → Partager », et rien d'autre dans le chemin courant. Le test vérifie que le cas simple
// tient en trois étapes, qu'une galerie sans club est un cas normal, et que tout ce qui est
// avancé (Club+, multi-liens, lien d'essai, filigrane) est rangé derrière « Options avancées ».
//
// Le réseau est simulé : on teste l'enchaînement de l'écran, pas la base — celle-ci a son propre
// test, galerie-sans-club.test.sql.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((req, res) => {
  if (req.url !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(html);
});
await new Promise((r) => srv.listen(0, r));

const nav = await chromium.launch();
const page = await nav.newPage();
const erreursJs = [];
page.on("pageerror", (e) => { const m = String(e).split("\n")[0]; if (!/ServiceWorker/i.test(m)) erreursJs.push(m); });
await page.goto(`http://localhost:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof modalMediasAlbum === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

// ── Réseau simulé ────────────────────────────────────────────────────────────
await page.evaluate(() => {
  window.__appels = [];
  window.sbFetch = async (path, opts) => {
    window.__appels.push({ path, body: opts?.body });
    if (path.includes("media_album_links_stats")) return window.__liens || [];
    if (path.includes("media_link_offers")) return window.__offres || [];
    if (path.includes("media_album_assets")) return window.__assets || [];
    if (path.includes("media_link_save")) {
      window.__liens = [{ id: "l1", slug: "tournoi-u12-sens", token: "JETON", label: "Lien principal" }];
      window.__offres = (opts.body.p_offers || []).map((o, i) => ({
        offer_id: "o" + i, offer_type: o.type, offer_name: o.name,
        price_cents: o.price_cents, photos_allowance: o.photos_allowance, is_featured: o.featured,
      }));
      return [{ ok: true, raison: null, link_id: "l1", slug: "tournoi-u12-sens", token: "JETON" }];
    }
    if (path.startsWith("media_albums?id=eq.")) return [{ id: "a1" }];
    return [];
  };
  window._galPeutTarifer = async () => true;
  window._galProduits = async () => [];
  S.role = "admin"; S.uid = "u1";
});

const ouvrir = async (album) => {
  await page.evaluate((a) => {
    window.__assets = a.__assets || [];
    _photoAlbums = [a];
    modalMediasAlbum(a.id);
  }, album);
  await page.waitForSelector("#gal-final", { state: "attached" });
  await page.waitForTimeout(250);
};

// ── 1. Une galerie sans club est un cas normal ───────────────────────────────
console.log("\n1. Galerie sans club, sans saison, sans équipe");
await ouvrir({ id: "a1", title: "Tournoi U12 — Sens", status: "draft", structure_externe: "FC Sens U12",
               event_date: "2026-09-08", photo_count: 0, watermark_previews: true, __assets: [] });
t("la galerie s'ouvre sans erreur", (await page.locator("#gal-final").count()) === 1);
t("le contexte affiche la structure externe", (await page.textContent("#sv-modal-ct")).includes("FC Sens U12"));
t("aucun tiret pour ce qui manque", !(await page.textContent("#sv-modal-ct")).includes("— · —"));
t("le statut annoncé est « Brouillon »", (await page.textContent("#sv-modal-ct")).includes("Brouillon"));

// ── 2. Les trois étapes, dans l'ordre ────────────────────────────────────────
console.log("\n2. Trois étapes visibles, le reste rangé");
const txt = await page.textContent("#sv-modal-ct");
t("étape 1 — Photos", /1\s*Photos/.test(txt.replace(/\s+/g, " ")));
t("étape 2 — Ce que vous vendez", txt.includes("Ce que vous vendez"));
t("étape 3 — Mettre en ligne", txt.includes("Mettre en ligne"));
t("les options avancées sont repliées", await page.evaluate(() => !document.querySelector("#sv-modal-ct details").open));
for (const avance of ["Filigrane", "Régénérer les aperçus"]) {
  t(`« ${avance} » est dans les options avancées`,
    await page.evaluate((a) => document.querySelector("#sv-modal-ct details").textContent.includes(a), avance));
}

// ── 3. Le bouton refuse de publier une galerie vide ──────────────────────────
console.log("\n3. Ce qui manque est dit, pas caché");
t("« Mettre la galerie en ligne » est désactivé sans photo ni offre",
  await page.locator('#gal-final button:has-text("Mettre la galerie en ligne")').isDisabled());
t("l'écran dit ce qui manque", (await page.textContent("#gal-final")).includes("Il manque"));

// ── 4. Définir les offres sans jamais parler de « lien » ─────────────────────
console.log("\n4. On définit ce qu'on vend, pas un « lien commercial »");
t("aucune mention de « lien » dans le parcours principal", await page.evaluate(() => {
  const ct = document.getElementById("sv-modal-ct").cloneNode(true);
  ct.querySelector("details")?.remove();          // hors options avancées
  return !/lien/i.test(ct.textContent);
}));

await page.evaluate(() => {
  window.__assets = [{ id: "p1", status: "ready" }, { id: "p2", status: "ready" }];
  _galAssets = window.__assets;
  galAjouterOffre("pack");
  _galOffres[0].name = "15 photos"; _galOffres[0].quota = "15"; _galOffres[0].prix = "10";
  galAjouterOffre("album_complet");
  _galOffres[1].name = "Toutes les photos"; _galOffres[1].prix = "40";
  _galRendreOffres();
});
await page.waitForTimeout(150);
const resume = await page.textContent("#gal-final");
t("le récapitulatif reprend la première offre", resume.includes("15 photos") && resume.includes("10 €"));
t("le récapitulatif reprend la seconde", resume.includes("Toutes les photos") && resume.includes("40 €"));
t("il annonce les photos prêtes", /2 photos prêtes/.test(resume));
t("il annonce le filigrane", resume.includes("filigrane"));
t("le bouton est maintenant actif",
  !(await page.locator('#gal-final button:has-text("Mettre la galerie en ligne")').isDisabled()));

// ── 5. Un seul geste met en ligne ────────────────────────────────────────────
console.log("\n5. Mettre en ligne : offres + lien + publication en un clic");
await page.click('#gal-final button:has-text("Mettre la galerie en ligne")');
await page.waitForTimeout(500);
const appels = await page.evaluate(() => window.__appels.map((a) => a.path));
t("les offres sont enregistrées", appels.some((p) => p.includes("media_link_save")));
t("la galerie est publiée", appels.some((p) => p.startsWith("media_albums?id=eq.")));
t("le lien principal a été créé sans que l'utilisateur le demande",
  await page.evaluate(() => !!_galLienPrincipal && _galLienPrincipal.slug === "tournoi-u12-sens"));

const final = await page.textContent("#gal-final");
t("l'écran annonce le succès", final.includes("Votre galerie est en ligne"));
for (const action of ["Copier le lien", "QR Code", "Ouvrir la galerie"]) {
  t(`action « ${action} » proposée`, final.includes(action));
}
t("pas dix boutons équivalents", await page.evaluate(() =>
  document.querySelectorAll("#gal-final button, #gal-final a").length <= 4));

t("aucune erreur JavaScript sur tout le parcours", erreursJs.length === 0, erreursJs.join(" | "));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
