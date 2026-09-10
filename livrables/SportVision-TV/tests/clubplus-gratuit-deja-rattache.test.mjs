// Club+ Gratuit pour une personne déjà rattachée à un club (décisions Club+ du 10/09/2026, n° 2).
//
// POURQUOI CE TEST. clubplus_claim_self_service_onboarding n'accorde qu'un club gratuit par
// personne (anti-abus). Règle gardée. Mais l'écran /signup-free ne le disait pas : la base ne
// créait rien, renvoyait le club existant, et Club+ l'ouvrait comme s'il venait d'être créé. La
// personne « retombait » dans son club sans comprendre. Décision : l'écran le dit, avant et après,
// avec un lien vers son espace ; aucune création silencieuse, aucune bascule muette.
//
//   G0  contrôle : un compte SANS club, connecté, voit le formulaire (le détecteur sait dire non)
//   G1  avant : déjà connecté, il arrive sur /signup-free → l'annonce, tout de suite
//   G2  avant : non connecté, il saisit son adresse (compte existant) puis son mot de passe →
//       l'annonce, sans que le serveur soit sollicité, et aucun club créé
//   G3  après : l'inscription gratuite en attente est rejouée à la connexion (clubplus-onboarding
//       répond already_onboarded) → l'annonce, aucun club créé, pas de bascule
//
//   node livrables/SportVision-TV/tests/clubplus-gratuit-deja-rattache.test.mjs
//   LOCAL=http://127.0.0.1:3400 FONCTIONS_LOCALES=clubplus-onboarding=http://127.0.0.1:8000 node …
//
// PROPRETÉ. Club de test « Villeneuve 340 SC », adresses zz-cp-dec-…@example.invalid, comptes
// créés par l'API d'administration : aucun e-mail. Tout est supprimé à la fin, et vérifié.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, enTeteAdmin } from "./_session-os.mjs";

const LOCAL = (process.env.LOCAL || "").replace(/\/+$/, "");
const FONCTIONS_LOCALES = Object.fromEntries(
  (process.env.FONCTIONS_LOCALES || "").split(",").filter((s) => s.includes("=")).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
);
const CLUB_NOM = "Villeneuve 340 SC";
const T0 = Date.now();
const MDP = "ZzClubplusDec!2026";
const { t, bilan } = rapporteur();
const traces = { emails: new Set() };
const adresse = (objet) => {
  const e = `zz-cp-dec-${objet}-${T0}@example.invalid`;
  traces.emails.add(e);
  return e;
};

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } });
const lire = async (chemin) => {
  const r = await api(chemin);
  return r.ok ? r.json() : [];
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
async function compteParEmail(email) {
  const d = await (await auth(`admin/users?filter=${encodeURIComponent(email.toLowerCase())}&per_page=50`)).json();
  return (d?.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}
async function creerCompte(email, user_metadata = {}) {
  const d = await (await auth("admin/users", { method: "POST", body: JSON.stringify({ email, password: MDP, email_confirm: true, user_metadata }) })).json();
  if (!d.id) throw new Error(`création du compte ${email} impossible : ${JSON.stringify(d).slice(0, 160)}`);
  return d.id;
}

// ── Navigateur (LOCAL : l'app locale servie sous l'origine de production) ──
async function brancherLocal(ctx) {
  if (!LOCAL) return;
  await ctx.route(`${CP}/**`, async (route) => {
    const url = route.request().url().replace(CP, LOCAL);
    const envoyes = { ...route.request().headers() };
    if (envoyes.origin) envoyes.origin = LOCAL;
    try {
      const rep = await route.fetch({ url, headers: envoyes, maxRedirects: 0 });
      const recus = { ...rep.headers() };
      if (recus.location) recus.location = recus.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, CP);
      if (rep.status() >= 300 && rep.status() < 400 && recus.location) {
        const cible = new URL(recus.location, route.request().url()).href;
        delete recus.location;
        delete recus["content-length"];
        return route.fulfill({ status: 200, headers: { ...recus, "content-type": "text/html; charset=utf-8" }, body: `<!doctype html><script>location.replace(${JSON.stringify(cible)})</script>` });
      }
      await route.fulfill({ response: rep, headers: recus });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}
// FONCTIONS_LOCALES : l'edge function modifiée, lancée avec deno contre la vraie base, sert les
// appels du navigateur — seule façon de la vérifier AVANT son déploiement.
async function brancherFonctions(ctx) {
  for (const [nom, cible] of Object.entries(FONCTIONS_LOCALES)) {
    await ctx.route(`${SB}/functions/v1/${nom}`, async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "ok" });
      const entetes = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !/^(host|content-length|connection|origin|referer|cookie)$/i.test(k)));
      const r = await fetch(cible, { method: req.method(), headers: entetes, body: req.postData() ?? undefined });
      await route.fulfill({ status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await r.text() });
    });
  }
}
async function ouvrir(nav) {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  await brancherLocal(ctx);
  await brancherFonctions(ctx);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
  return { ctx, page, erreurs };
}
const texte = async (page) => ((await page.evaluate(() => document.body?.innerText || "").catch(() => "")) || "").replace(/\s+/g, " ");
async function connecter(page, email) {
  await page.goto(`${CP}/clubplus/auth/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(MDP);
  await page.locator("button", { hasText: "Se connecter" }).first().click();
  await page.waitForTimeout(12000);
}
const ANNONCE = /déjà rattaché à « Villeneuve 340 SC »/;
const REGLE = /Club\+ Gratuit se limite à un club par personne ; pour un second club, contactez SportVision/;

async function scenario(nom, fn) {
  try { await fn(); } catch (e) { t(`${nom} : le parcours va jusqu'au bout`, false, String(e?.message || e).split("\n")[0].slice(0, 220)); }
}

let club = null;
const nav = await chromium.launch();
try {
  club = (await lire(`clubs?select=id,nom&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
  if (!club) throw new Error("club de test introuvable");
  console.log(`Cible : ${LOCAL ? `app locale ${LOCAL} servie sous ${CP}` : CP}${Object.keys(FONCTIONS_LOCALES).length ? ` · fonctions locales : ${Object.keys(FONCTIONS_LOCALES).join(", ")}` : ""}`);
  const membre = async (objet, metadata) => {
    const email = adresse(objet);
    const id = await creerCompte(email, metadata);
    const r = await api("club_members", { method: "POST", body: JSON.stringify({ user_id: id, club_id: club.id, role: "coach", status: "actif", prenom: "ZZ", nom: `Gratuit ${objet}`, teams: [] }) });
    if (!r.ok) throw new Error(`rattachement impossible : ${await r.text()}`);
    return { email, id };
  };

  // G0 · Contrôle : sans club, le formulaire s'affiche (sinon l'annonce ne prouverait rien).
  await scenario("G0", async () => {
    const email = adresse("sans-club");
    await creerCompte(email);
    const { ctx, page } = await ouvrir(nav);
    try {
      await connecter(page, email);
      await page.goto(`${CP}/clubplus/signup-free`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      const tx = await texte(page);
      t("G0 contrôle : un compte sans club, connecté, voit le formulaire Club+ Gratuit", /Créez votre espace Club\+ Gratuit/.test(tx) && !/Vous avez déjà un club/.test(tx), tx.slice(0, 200));
    } finally { await ctx.close(); }
  });

  // G1 · Avant : déjà connecté, il arrive sur /signup-free.
  await scenario("G1", async () => {
    const { email } = await membre("deja-connecte");
    const { ctx, page, erreurs } = await ouvrir(nav);
    try {
      await connecter(page, email);
      await page.goto(`${CP}/clubplus/signup-free`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      const tx = await texte(page);
      t("G1 avant : déjà connecté, /signup-free annonce le club existant", ANNONCE.test(tx), tx.slice(0, 240));
      t("G1 avant : et la règle d'un club gratuit par personne, mot pour mot", REGLE.test(tx), tx.slice(0, 240));
      const lien = page.locator("button", { hasText: "Accéder à mon espace" }).first();
      t("G1 : un lien vers son espace est proposé", (await lien.count()) === 1);
      if (await lien.count()) {
        await lien.click();
        await page.waitForTimeout(9000);
        t("G1 : le lien ouvre son espace, dans son club", /\/clubplus\/dashboard/.test(page.url()) && (await texte(page)).includes(CLUB_NOM), page.url().replace(CP, ""));
      }
      t("G1 : aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" · "));
    } finally { await ctx.close(); }
  });

  // G2 · Avant : non connecté, compte existant.
  await scenario("G2", async () => {
    const { email } = await membre("compte-existant");
    const nomClub = `ZZ Test Gratuit Deja ${T0}`;
    const { ctx, page, erreurs } = await ouvrir(nav);
    let appelsOnboarding = 0;
    page.on("request", (r) => { if (/functions\/v1\/clubplus-onboarding/.test(r.url()) && r.method() === "POST") appelsOnboarding++; });
    try {
      await page.goto(`${CP}/clubplus/signup-free`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await page.getByLabel("Nom du club").fill(nomClub);
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.locator("input[type=password]").fill("AutreMotDePasse!9");
      await page.locator("button", { hasText: /Créer mon espace Club\+ Gratuit/ }).first().click();
      await page.waitForTimeout(6000);
      const avantConnexion = await texte(page);
      t("G2 avant la connexion : la limite d'un club par personne est annoncée", /se limite à un club par personne/.test(avantConnexion), avantConnexion.slice(-260));
      await page.locator("input[type=password]").fill(MDP);
      await page.locator("button", { hasText: /connecter et créer/i }).first().click();
      await page.waitForTimeout(10000);
      const tx = await texte(page);
      t("G2 avant la création : l'annonce du club existant, et la règle", ANNONCE.test(tx) && REGLE.test(tx), tx.slice(0, 240));
      t("G2 : le serveur n'est même pas sollicité", appelsOnboarding === 0, `${appelsOnboarding} appel(s) à clubplus-onboarding`);
      t("G2 : aucun club créé à ce nom", (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(nomClub)}`)).length === 0);
      t("G2 : aucune bascule, la personne reste sur l'annonce", /\/clubplus\/signup-free/.test(page.url()), page.url().replace(CP, ""));
      t("G2 : aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" · "));
    } finally { await ctx.close(); }
  });

  // G3 · Après : l'inscription gratuite en attente (métadonnées du compte, comme après un lien de
  // confirmation ouvert sur un autre appareil) est rejouée à la connexion.
  await scenario("G3", async () => {
    const nomClub = `ZZ Test Gratuit Apres ${T0}`;
    const { email, id } = await membre("en-attente", { sv_pending_signup: { kind: "clubplus-free-signup", clubNom: nomClub, prenom: "ZZ", nom: "Apres", telephone: "" } });
    const { ctx, page, erreurs } = await ouvrir(nav);
    let reponseOnboarding = null;
    page.on("response", async (r) => {
      if (/functions\/v1\/clubplus-onboarding/.test(r.url()) && r.request().method() === "POST") reponseOnboarding = await r.json().catch(() => null);
    });
    try {
      await connecter(page, email);
      await page.waitForTimeout(3000);
      const tx = await texte(page);
      t("G3 : la base refuse un second club gratuit (already_onboarded)", reponseOnboarding?.already_onboarded === true, JSON.stringify(reponseOnboarding));
      t("G3 après : l'écran annonce le club existant et la règle", ANNONCE.test(tx) && REGLE.test(tx), `${page.url().replace(CP, "")} — ${tx.slice(0, 200)}`);
      t("G3 : aucune bascule muette vers le club existant", !/\/clubplus\/dashboard/.test(page.url()), page.url().replace(CP, ""));
      t("G3 : aucun club créé à ce nom", (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(nomClub)}`)).length === 0);
      const u = await (await auth(`admin/users/${id}`)).json();
      t("G3 : l'inscription en attente est oubliée (elle ne se rejouera pas à chaque connexion)", !u?.user_metadata?.sv_pending_signup, JSON.stringify(u?.user_metadata || {}).slice(0, 160));
      t("G3 : aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" · "));
    } finally { await ctx.close(); }
  });
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.message || e).slice(0, 200));
} finally {
  await nav.close();
  // ── Nettoyage, vérifié ──
  const del = (chemin) => api(chemin, { method: "DELETE" });
  const ids = [];
  for (const e of traces.emails) { const u = await compteParEmail(e); if (u) ids.push(u.id); }
  // Garde-fou : on ne supprime JAMAIS un club dont le nom ne commence pas par « ZZ Test ».
  for (const c of await lire(`clubs?select=id,nom&nom=like.ZZ%20Test%20Gratuit*${T0}*`)) {
    if (!/^ZZ Test/.test(c.nom)) continue;
    await del(`club_members?club_id=eq.${c.id}`);
    await del(`club_onboarding_events?club_id=eq.${c.id}`);
    await del(`clubs?id=eq.${c.id}`);
  }
  if (club) for (const id of ids) await del(`club_onboarding_events?club_id=eq.${club.id}&auteur_id=eq.${id}`);
  for (const id of ids) {
    await del(`club_members?user_id=eq.${id}`);
    await del(`memberships?user_id=eq.${id}`);
    await del(`client_users?id=eq.${id}`);
    await del(`notifications?destinataire_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  }
  await del(`notifications?message=ilike.*ZZ%20Test%20Gratuit*${T0}*`);
  const restes = [];
  for (const e of traces.emails) if (await compteParEmail(e)) restes.push(`compte ${e}`);
  for (const id of ids) if ((await lire(`club_members?select=id&user_id=eq.${id}`)).length) restes.push(`rattachement ${id}`);
  if ((await lire(`clubs?select=id&nom=like.*${T0}*`)).length) restes.push("club ZZ");
  if (club && (await lire(`club_onboarding_events?select=id&club_id=eq.${club.id}&detail=ilike.ZZ*`)).length) restes.push("journal du club");
  t("nettoyage : aucune trace laissée", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
}
process.exit(bilan() ? 1 : 0);
