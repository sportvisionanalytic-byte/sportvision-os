// Parcours réel de la galerie publique, dans Chromium, sur la vraie base et les vraies photos.
import { chromium, devices } from "../../SportVision-Connect/app-connect/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:3311";
const SLUG = process.env.SLUG;
const TOKEN = process.env.TOKEN;
const SHOTS = process.env.SHOTS ?? "/tmp";

let ko = 0;
const ok = (n, c, d = "") => {
  if (!c) ko++;
  console.log(`${c ? "OK  " : "KO  "} ${n}${d ? `  (${d})` : ""}`);
};

const browser = await chromium.launch();

// ── Mobile : le cas d'usage réel (lien WhatsApp, iPhone) ──────────────────
const phone = await browser.newContext({ ...devices["iPhone 13"] });
const page = await phone.newPage();

const t0 = Date.now();
await page.goto(`${BASE}/gallery/${SLUG}?k=${TOKEN}`, { waitUntil: "domcontentloaded" });
const ttdc = Date.now() - t0;
ok("page ouverte sans compte", page.url().includes("/gallery/"), page.url().replace(BASE, ""));
ok("pas de redirection vers la connexion", !page.url().includes("/auth/login"));
ok("rendu initial rapide", ttdc < 4000, `${ttdc} ms`);

await page.waitForSelector("img[loading]", { timeout: 15000 });
const titre = await page.textContent("h1");
ok("titre de la galerie affiché", titre?.includes("Villneuve Cup U18"), titre?.trim());

const infos = await page.textContent("header");
ok("club, équipe et date affichés", /Villneuve 340 SC/.test(infos ?? "") && /U18 D2/.test(infos ?? "") && /6 septembre 2026/.test(infos ?? ""));
ok("nombre de photos affiché", /20 photos/.test(infos ?? ""));

// Les 2 photos non publiables (masquée + en traitement) ne doivent jamais apparaître.
await page.waitForTimeout(1500);
const tiles = await page.locator("main img").count();
ok("seules les photos publiables sont affichées", tiles === 20, `${tiles} vignettes pour 20 prêtes / 22 en base`);

// Aucune URL d'original ne doit exister dans la page.
const html = await page.content();
ok("aucun chemin d'original dans la page", !html.includes("sportvision-media-prive") && !html.includes("original_path"));
ok("les vignettes viennent bien du bucket public", html.includes("galerie-previews"));

// Layout shift : la place doit être réservée par le ratio réel.
const sansRatio = await page.locator("main img:not([style*='aspect-ratio'])").count();
ok("chaque vignette réserve sa place (pas de saut de page)", sansRatio === 0, `${sansRatio} sans ratio`);

await page.screenshot({ path: `${SHOTS}/galerie-mobile-grille.png`, fullPage: false });

// ── Sélection ─────────────────────────────────────────────────────────────
const boutonsSelection = page.locator("main button[aria-pressed]");
await boutonsSelection.nth(0).click();
await boutonsSelection.nth(1).click();
await boutonsSelection.nth(2).click();
await page.waitForTimeout(400);
let barre = await page.textContent("div.fixed.inset-x-0.bottom-0");
ok("barre de sélection affichée sur mobile", /3 photos sélectionnées/.test(barre ?? ""), barre?.replace(/\s+/g, " ").trim().slice(0, 70));
ok("3 photos à l'unité = 12 €", /12\s?€/.test(barre ?? ""));

// 4e photo : le pack de 5 doit s'appliquer tout seul (15 € < 16 €).
await boutonsSelection.nth(3).click();
await page.waitForTimeout(400);
barre = await page.textContent("div.fixed.inset-x-0.bottom-0");
ok("4 photos : pack 5 appliqué automatiquement (15 €)", /15\s?€/.test(barre ?? ""), barre?.replace(/\s+/g, " ").trim().slice(0, 90));
ok("économie annoncée", /économie/.test(barre ?? ""));
await page.screenshot({ path: `${SHOTS}/galerie-mobile-selection.png` });

// Désélection.
await boutonsSelection.nth(3).click();
await page.waitForTimeout(300);
barre = await page.textContent("div.fixed.inset-x-0.bottom-0");
ok("désélection prise en compte", /3 photos/.test(barre ?? ""));

// ── Panier ────────────────────────────────────────────────────────────────
await page.getByRole("button", { name: "Voir mon panier" }).click();
await page.waitForSelector("[aria-label='Mon panier']");
const panier = await page.textContent("[aria-label='Mon panier']");
ok("panier : produit issu de l'OS, pas un prix codé", /Photo à l'unité/.test(panier ?? ""));
ok("panier : total affiché", /12\s?€/.test(panier ?? ""));
ok("panier : achat sans compte annoncé", /Aucun compte/.test(panier ?? ""));
await page.screenshot({ path: `${SHOTS}/galerie-mobile-panier.png` });
await page.locator("[aria-label='Mon panier'] button[aria-label='Fermer']").click();

// ── Visionneuse ───────────────────────────────────────────────────────────
await page.locator("main button[aria-label^='Ouvrir la photo']").first().click();
await page.waitForSelector("[role='dialog'][aria-label*='Photo']");
const lb = await page.textContent("[role='dialog'][aria-label*='Photo']");
ok("visionneuse : compteur affiché", /1 \/ 20/.test(lb ?? ""));
const lbImg = await page.locator("[role='dialog'] img").getAttribute("src");
ok("visionneuse : c'est l'aperçu 1600 px, pas la vignette", (lbImg ?? "").includes("-p."), lbImg?.split("/").pop());
await page.screenshot({ path: `${SHOTS}/galerie-mobile-visionneuse.png` });

// Swipe vers la photo suivante. `page.mouse` n'emet PAS d'evenements tactiles : il faut passer
// par le protocole Chrome, sinon on teste une souris et pas un pouce.
const box = await page.locator("[role='dialog'] img").boundingBox();
if (box) {
  const cdp = await phone.newCDPSession(page);
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 20, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width / 2, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 20, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await page.waitForTimeout(400);
const lb2 = await page.textContent("[role='dialog'][aria-label*='Photo']");
ok("visionneuse : swipe vers la photo suivante", /2 \/ 20/.test(lb2 ?? ""), lb2?.match(/\d+ \/ \d+/)?.[0]);

await page.locator("[role='dialog'] button[aria-label='Fermer']").click();
await page.waitForTimeout(300);
barre = await page.textContent("div.fixed.inset-x-0.bottom-0");
ok("sélection conservée après la visionneuse", /3 photos/.test(barre ?? ""));

// Rechargement : la sélection doit survivre (§18).
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
barre = await page.textContent("div.fixed.inset-x-0.bottom-0").catch(() => null);
ok("sélection conservée après rechargement", /3 photos/.test(barre ?? ""), (barre ?? "").replace(/\s+/g, " ").trim().slice(0, 40));

// ── Liens invalides ───────────────────────────────────────────────────────
for (const [nom, url, attendu] of [
  ["mauvais jeton", `${BASE}/gallery/${SLUG}?k=faux-jeton`, "n'existe plus"],
  ["jeton absent", `${BASE}/gallery/${SLUG}`, "n'existe plus"],
  ["galerie inexistante", `${BASE}/gallery/inconnue?k=${TOKEN}`, "n'existe plus"],
]) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const h1 = await page.textContent("h1");
  ok(`lien invalide (${nom}) : page propre SportVision`, (h1 ?? "").includes(attendu), h1?.trim());
  const body = await page.content();
  ok(`lien invalide (${nom}) : aucune photo divulguée`, !body.includes("galerie-previews"));
}
await page.screenshot({ path: `${SHOTS}/galerie-lien-invalide.png` });

// ── Desktop ───────────────────────────────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dpage = await desk.newPage();
await dpage.goto(`${BASE}/gallery/${SLUG}?k=${TOKEN}`, { waitUntil: "domcontentloaded" });
await dpage.waitForSelector("main img");
await dpage.waitForTimeout(1200);
await dpage.screenshot({ path: `${SHOTS}/galerie-desktop.png` });
const colonnes = await dpage.evaluate(() => getComputedStyle(document.querySelector("main div.columns-2")).columnCount);
ok("desktop : grille en 4 colonnes", colonnes === "4", `${colonnes} colonnes`);

await dpage.locator("main button[aria-label^='Ouvrir la photo']").first().click();
await dpage.waitForSelector("[role='dialog'][aria-label*='Photo']");
await dpage.keyboard.press("ArrowRight");
await dpage.waitForTimeout(300);
const dlb = await dpage.textContent("[role='dialog'][aria-label*='Photo']");
ok("desktop : flèche clavier passe à la photo suivante", /2 \/ 20/.test(dlb ?? ""));
await dpage.keyboard.press("Escape");
await dpage.waitForTimeout(300);
ok("desktop : Échap ferme la visionneuse", (await dpage.locator("[role='dialog'][aria-label*='Photo']").count()) === 0);

// ── Tablette ──────────────────────────────────────────────────────────────
const tab = await browser.newContext({ ...devices["iPad Mini"] });
const tpage = await tab.newPage();
await tpage.goto(`${BASE}/gallery/${SLUG}?k=${TOKEN}`, { waitUntil: "domcontentloaded" });
await tpage.waitForSelector("main img");
const tcol = await tpage.evaluate(() => getComputedStyle(document.querySelector("main div.columns-2")).columnCount);
ok("tablette : grille en 3 colonnes", tcol === "3", `${tcol} colonnes`);
await tpage.screenshot({ path: `${SHOTS}/galerie-tablette.png` });

// ── Petit smartphone ──────────────────────────────────────────────────────
const small = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
const spage = await small.newPage();
await spage.goto(`${BASE}/gallery/${SLUG}?k=${TOKEN}`, { waitUntil: "domcontentloaded" });
await spage.waitForSelector("main img");
const debord = await spage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
ok("petit écran 320 px : aucun débordement horizontal", !debord);
await spage.screenshot({ path: `${SHOTS}/galerie-320.png` });

await browser.close();
console.log(`\n${ko === 0 ? "Tout conforme." : `${ko} echec(s).`}`);
process.exit(ko ? 1 : 0);
