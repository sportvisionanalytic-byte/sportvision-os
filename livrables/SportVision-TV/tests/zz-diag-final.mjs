import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS } from "./_session-os.mjs";
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const admin = (await sql(`select id, email, prenom, role from profiles where role='admin' and actif order by created_at limit 1`))[0];
const album = (await sql(`select id from media_albums where title like '%paris acasa%' limit 1`))[0];
const nav = await chromium.launch();
const P = await ouvrirOS(nav, admin, { largeur: 1440, hauteur: 900 });
await P.page.evaluate(() => window.switchView && window.switchView("media"));
await P.page.waitForTimeout(3500);
await P.page.evaluate((id) => window.ouvrirGalerie(id), album.id);
await P.page.waitForTimeout(6000);
console.log(await P.page.evaluate(() => {
  const f = document.getElementById("gal-final");
  if (!f) return "gal-final absent";
  const bloc = f.firstElementChild;
  if (!bloc) return "bloc vide : " + f.innerHTML.slice(0, 80);
  const cs = getComputedStyle(bloc); const r = bloc.getBoundingClientRect();
  return { html: bloc.outerHTML.slice(0, 120), rayon: cs.borderRadius, taille: `${Math.round(r.width)}x${Math.round(r.height)}`, padding: cs.padding };
}));
await nav.close();
