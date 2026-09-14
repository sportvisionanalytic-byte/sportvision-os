// Un rayon de 999px (--rp) sur un BLOC large donne une gelule geante : les coins rognent le
// contenu et le texte parait deborder. Sur un bouton c'est voulu, sur un bloc c'est un defaut.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS } from "./_session-os.mjs";
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const DET = () => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    const rayon = parseFloat(cs.borderTopLeftRadius) || 0;
    // Gelule assumee : un bouton, une pastille, une ligne courte. Defaut : un bloc qui contient
    // plusieurs lignes et dont la hauteur depasse largement celle d'un controle.
    const estControle = ["BUTTON", "A", "INPUT", "SELECT", "LABEL"].includes(el.tagName);
    if (rayon >= 100 && r.height >= 70 && r.width >= 240 && !estControle) {
      const enfants = el.querySelectorAll("button, a, input").length;
      out.push({ el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : ""),
        taille: `${Math.round(r.width)}x${Math.round(r.height)}`, rayon: Math.round(rayon), enfants,
        texte: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60) });
    }
  }
  return out;
};
const admin = (await sql(`select id, email, prenom, role from profiles where role='admin' and actif order by created_at limit 1`))[0];
const album = (await sql(`select id from media_albums where title like '%paris acasa%' limit 1`))[0];
const nav = await chromium.launch();
const P = await ouvrirOS(nav, admin, { largeur: 1440, hauteur: 900 });
const vues = ["media", "dashboard", "prestations", "finance", "clients", "equipe"];
for (const v of vues) {
  await P.page.evaluate((x) => window.switchView && window.switchView(x), v);
  await P.page.waitForTimeout(3500);
  const pbs = await P.page.evaluate(DET);
  console.log(`\n=== vue ${v}`);
  (pbs.length ? pbs.slice(0, 8) : [{ texte: "rien" }]).forEach((p) => console.log(`   ${p.el || ""} ${p.taille || ""} r=${p.rayon || ""} « ${p.texte} »`));
}
await P.page.evaluate((id) => window.ouvrirGalerie(id), album.id);
await P.page.waitForTimeout(6000);
const pbs = await P.page.evaluate(DET);
console.log(`\n=== fiche galerie`);
(pbs.length ? pbs.slice(0, 10) : [{ texte: "rien" }]).forEach((p) => console.log(`   ${p.el || ""} ${p.taille || ""} r=${p.rayon || ""} « ${p.texte} »`));
await nav.close();
