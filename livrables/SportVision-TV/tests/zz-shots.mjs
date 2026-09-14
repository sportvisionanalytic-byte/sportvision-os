import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS } from "./_session-os.mjs";
const SP = process.env.SP;
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const admin = (await sql(`select id, email, prenom, role from profiles where role='admin' and actif order by created_at limit 1`))[0];
const album = (await sql(`select id from media_albums where title like '%paris acasa%' limit 1`))[0];
const nav = await chromium.launch();
for (const [tag, w, h] of [["bureau", 1440, 900], ["mobile", 390, 844]]) {
  const P = await ouvrirOS(nav, admin, { largeur: w, hauteur: h });
  await P.page.evaluate(() => window.switchView && window.switchView("media"));
  await P.page.waitForTimeout(4500);
  await P.page.screenshot({ path: `${SP}/ui-${tag}-liste.png`, fullPage: false });
  await P.page.evaluate((id) => window.ouvrirGalerie(id), album.id);
  await P.page.waitForTimeout(6000);
  await P.page.screenshot({ path: `${SP}/ui-${tag}-fiche.png`, fullPage: true });
  console.log(tag, "ok");
  await P.page.context().close();
}
await nav.close();
