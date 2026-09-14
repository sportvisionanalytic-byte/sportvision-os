import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS } from "./_session-os.mjs";
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();

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

const admin = (await sql(`select id, email, prenom, role from profiles where role='admin' and actif order by created_at limit 1`))[0];
const nav = await chromium.launch();
for (const [nomVue, w, h] of [["bureau 1440", 1440, 900], ["portable 1280", 1280, 800], ["mobile 390", 390, 844]]) {
  const P = await ouvrirOS(nav, admin, { largeur: w, hauteur: h });
  await P.page.evaluate(() => window.switchView && window.switchView("media"));
  await P.page.waitForTimeout(4000);
  let pbs = await P.page.evaluate(DETECTEUR);
  console.log(`\n=== OS · liste des galeries — ${nomVue}`);
  (pbs.length ? pbs.slice(0, 10) : [{ texte: "rien a signaler" }]).forEach((p) => console.log(`   [${p.type || ""}] ${p.el || ""} « ${p.texte} »  ${p.mesure || ""}`));

  const album = (await sql(`select id from media_albums where title like 'Villemomble Cup U10 - paris acasa%' limit 1`))[0];
  await P.page.evaluate((id) => window.ouvrirGalerie(id), album.id);
  await P.page.waitForTimeout(6000);
  pbs = await P.page.evaluate(DETECTEUR);
  console.log(`=== OS · fiche galerie — ${nomVue}`);
  (pbs.length ? pbs.slice(0, 12) : [{ texte: "rien a signaler" }]).forEach((p) => console.log(`   [${p.type || ""}] ${p.el || ""} « ${p.texte} »  ${p.mesure || ""}`));
  await P.page.context().close();
}
await nav.close();
