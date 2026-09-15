// Un lien de galerie coupé dit qu'il est coupé (15/09/2026).
//
//   node livrables/SportVision-TV/tests/galerie-lien-tronque.test.mjs
//
// Fouka : « un coach m'a dit que la galerie ne marche pas, la galerie de Creil, le lien n'existe
// plus ». La galerie de Creil marchait : 41 photos, deux formules, lien actif, page à 200. Ce que
// le coach avait ouvert, c'est le lien AMPUTÉ de son jeton — recopié sans la fin, comme il arrive
// dans un message WhatsApp ou un QR mal cadré. Et la page lui répondait « Cette galerie n'existe
// plus ».
//
// Le second paragraphe disait déjà la vérité. Personne ne le lit quand le titre a tranché : le
// club a conclu que les photos avaient disparu, et la vente avec.
//
// Ce test ouvre une vraie galerie publiée de deux façons — lien entier, puis lien sans son jeton —
// et vérifie que la seconde n'annonce jamais une disparition.
import { chromium, devices } from "../../SportVision-Connect/app-connect/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, rapporteur } from "./_session-os.mjs";

const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const { t, bilan } = rapporteur();
const BASE = (process.env.BASE || "https://connect.sportvision-an.fr").replace(/\/+$/, "");

const nav = await chromium.launch();
try {
  const lien = (await sql(`select l.slug, l.token, a.title, a.photo_count
    from media_album_links l join media_albums a on a.id = l.album_id
    where a.status = 'published' and l.is_enabled and (l.expires_at is null or l.expires_at > now())
    order by a.created_at desc limit 1`))[0];
  if (!lien) throw new Error("aucune galerie publiée pour ce test");

  const ouvrir = async (url) => {
    const ctx = await nav.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const texte = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const vignettes = await page.locator("main img").count();
    await ctx.close();
    return { texte, vignettes };
  };

  const entier = await ouvrir(`${BASE}/gallery/${lien.slug}?k=${lien.token}`);
  t("le lien entier ouvre les photos", entier.vignettes > 0 && entier.texte.includes(lien.title),
    `${entier.vignettes} vignette(s)`);

  const coupe = await ouvrir(`${BASE}/gallery/${lien.slug}`);
  t("le lien coupé n'annonce pas une galerie disparue", !/n'existe plus|nexiste plus/i.test(coupe.texte),
    coupe.texte.slice(0, 130));
  t("il dit que c'est le LIEN qui est incomplet", /manque la fin|incomplet/i.test(coupe.texte),
    coupe.texte.slice(0, 130));
  t("il montre la fin qui manque", /\?k=/.test(coupe.texte));
  t("et il ne montre aucune photo", coupe.vignettes === 0);
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 180));
} finally {
  await nav.close();
  bilan();
}
