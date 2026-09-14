// Rien ne doit deborder de son cadre, ni etre coupe par lui (14/09/2026).
//
//   node livrables/SportVision-TV/tests/interface-debordements.test.mjs
//
// Fouka : « des ecrits qui depassent, bien aligner, ajuster les interfaces ». Ce genre de defaut
// se voit a l'oeil et ne se lit pas dans le code — mais il se MESURE dans un navigateur.
//
// Trois mesures, sur les vraies pages, en mobile et en bureau :
//   1. la page ne defile pas de travers ;
//   2. aucun texte n'est coupe par son conteneur (hors coupure assumee par points de suspension,
//      et hors conteneur qui defile volontairement — une barre d'onglets, un tableau large) ;
//   3. aucun PANNEAU n'est arrondi comme une gelule. `--rp` vaut 999px : c'est le rayon des
//      boutons. Sur un bloc large, il dessine un arc qui rogne les coins et fait paraitre le
//      contenu hors cadre — 29 panneaux etaient dans ce cas le 14/09, dont le recapitulatif
//      « Votre galerie est en ligne ». Aucun detecteur de debordement ne le voyait : les elements
//      tiennent dans leur boite, c'est la boite qui est mal dessinee.
import { chromium, devices } from "../../SportVision-Connect/app-connect/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin } from "./_session-os.mjs";

const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();

const MESURER = () => {
  const out = []; const doc = document.documentElement; const vus = new Set();
  if (doc.scrollWidth > doc.clientWidth + 1)
    out.push({ type: "page", texte: `la page defile de travers (${doc.scrollWidth} > ${doc.clientWidth})` });
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
    const nom = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
    // Gelule sur un panneau.
    const rayon = parseFloat(cs.borderTopLeftRadius) || 0;
    const estControle = ["BUTTON", "A", "INPUT", "SELECT", "LABEL", "IMG"].includes(el.tagName);
    if (rayon >= 100 && r.height >= 70 && r.width >= 240 && !estControle) {
      const sig = "gelule|" + nom + texte;
      if (!vus.has(sig)) { vus.add(sig); out.push({ type: "gelule", nom, texte, mesure: `${Math.round(r.width)}x${Math.round(r.height)} rayon ${Math.round(rayon)}px` }); }
    }
    if (!texte) continue;
    const sig = el.tagName + "|" + texte;
    if (vus.has(sig)) continue;
    const scrollable = ["auto", "scroll"].includes(cs.overflowX) || ["auto", "scroll"].includes(cs.overflowY);
    const ellipsis = cs.textOverflow === "ellipsis";
    const coupeX = el.scrollWidth > el.clientWidth + 2 && !scrollable && !ellipsis;
    const horsEcran = (r.right > doc.clientWidth + 2 || r.left < -2) && !dansUnDefilant(el);
    if (coupeX || horsEcran) {
      vus.add(sig);
      out.push({ type: horsEcran ? "hors-ecran" : "coupe", nom, texte,
        mesure: `${Math.round(r.left)}..${Math.round(r.right)} / ${doc.clientWidth}` });
    }
  }
  return out;
};

const r = []; const t = (n, ok, d = "") => r.push(`${ok ? "ok  " : "KO  "} ${n}${d ? "  · " + d : ""}`);
const nav = await chromium.launch();
try {
  const lien = (await sql(`select l.slug, l.token from media_album_links l join media_albums a on a.id=l.album_id
    where a.status='published' and a.access_mode<>'free_members' order by a.created_at desc limit 1`))[0];
  const pages = [];
  if (lien) pages.push({ nom: "galerie publique", url: `https://connect.sportvision-an.fr/gallery/${lien.slug}?k=${lien.token}` });
  pages.push({ nom: "Connect — connexion", url: "https://connect.sportvision-an.fr/auth/login" });
  pages.push({ nom: "Club+ — connexion", url: "https://clubplus.sportvision-an.fr/clubplus/auth/login" });

  for (const p of pages) {
    for (const [vue, opts] of [["mobile", { ...devices["iPhone 13"] }], ["bureau", { viewport: { width: 1440, height: 900 } }]]) {
      const ctx = await nav.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(p.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      const pbs = await page.evaluate(MESURER);
      t(`${p.nom} · ${vue}`, pbs.length === 0,
        pbs.slice(0, 3).map((x) => `[${x.type}] ${x.nom || ""} « ${x.texte} » ${x.mesure || ""}`).join(" | "));
      await ctx.close();
    }
  }
} catch (e) {
  t("deroule", false, String(e.message).slice(0, 180));
} finally {
  await nav.close();
  console.log(r.join("\n"));
  const ok = r.filter((l) => l.startsWith("ok")).length;
  console.log(`\n${ok}/${r.length} verifications passees.`);
  process.exit(ok === r.length ? 0 : 1);
}
