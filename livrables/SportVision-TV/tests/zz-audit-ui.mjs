// Detecteur de debordements : ce qui sort de son conteneur, ce qui est coupe, ce qui fait
// defiler la page de travers. Sur les vraies pages, en mobile et en bureau.
import { chromium, devices } from "../../SportVision-Connect/app-connect/node_modules/playwright/index.mjs";

const CIBLES = JSON.parse(process.env.CIBLES);
const DETECTEUR = () => {
  const out = []; const doc = document.documentElement; const vus = new Set();
  if (doc.scrollWidth > doc.clientWidth + 1) out.push({ type: "page", texte: `defile de travers ${doc.scrollWidth} > ${doc.clientWidth}` });
  // Un ancetre qui defile volontairement (barre d'onglets, tableau large) explique qu'un enfant
  // sorte de l'ecran : ce n'est pas un defaut. De meme, un texte coupe avec des points de
  // suspension est un choix, pas un debordement.
  const dansUnDefilant = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (["auto", "scroll"].includes(cs.overflowX) && p.scrollWidth > p.clientWidth + 2) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const texte = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 55);
    if (!texte) continue;
    const sig = el.tagName + "|" + texte;
    if (vus.has(sig)) continue;
    const scrollable = ["auto", "scroll"].includes(cs.overflowX) || ["auto", "scroll"].includes(cs.overflowY);
    const ellipsis = cs.textOverflow === "ellipsis";
    const coupeX = el.scrollWidth > el.clientWidth + 2 && !scrollable && !ellipsis;
    const coupeY = el.scrollHeight > el.clientHeight + 4 && cs.overflowY === "hidden" && !ellipsis;
    const horsEcran = (r.right > doc.clientWidth + 2 || r.left < -2) && !dansUnDefilant(el);
    if (coupeX || coupeY || horsEcran) {
      vus.add(sig);
      out.push({ type: horsEcran ? "hors-ecran" : coupeX ? "coupe-largeur" : "coupe-hauteur",
        el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : ""),
        texte, mesure: `${Math.round(r.left)}..${Math.round(r.right)}/${doc.clientWidth} scroll ${el.scrollWidth}/${el.clientWidth}` });
    }
  }
  return out;
};

const nav = await chromium.launch();
for (const c of CIBLES) {
  for (const [nomVue, ctxOpts] of [["mobile 390", { ...devices["iPhone 13"] }], ["bureau 1440", { viewport: { width: 1440, height: 900 } }]]) {
    const ctx = await nav.newContext(ctxOpts);
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 120)));
    await page.goto(c.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(c.attente || 5000);
    if (c.clic) { await page.locator(c.clic).first().click().catch(() => {}); await page.waitForTimeout(2500); }
    const pbs = await page.evaluate(DETECTEUR);
    console.log(`\n=== ${c.nom} — ${nomVue}`);
    if (!pbs.length) console.log("   rien a signaler");
    for (const p of pbs.slice(0, 12)) console.log(`   [${p.type}] ${p.el || ""} « ${p.texte || p.info} »\n        ${p.mesure || ""}`);
    if (erreurs.length) console.log("   ERREURS JS :", erreurs.slice(0, 2).join(" | "));
    await ctx.close();
  }
}
await nav.close();
