// Creation d'un compte dans l'OS et premiere connexion, de bout en bout.
//
// POURQUOI. « A chaque fois qu'il y a la creation d'un compte, il y a un bug » (Fouka, 10/09/2026).
// L'audit du meme jour a trouve, sur la version en ligne : une fenetre d'invitation qui n'affichait
// que son titre, un lien annonce valable 7 jours qui mourait en une heure, aucun moyen de renvoyer
// un lien expire, une fenetre de mot de passe qu'on pouvait fermer pour entrer sans mot de passe,
// des erreurs de connexion toutes identiques, une recrue en integration dont le lien etait perdu,
// et des messages anglais bruts. Ce test rejoue chacun de ces parcours.
//
// COMMENT. Tout est reel sauf la page : l'OS du depot est servi en local (le code teste est celui
// qu'on s'apprete a livrer), mais il parle au vrai Supabase, avec de vrais liens d'invitation et de
// vrais jetons. Les fonctions serveur appelees sont celles DEPLOYEES ; avec FONCTION_LOCALE=1,
// invite-collaborateur est executee depuis le depot sous Deno (utile avant un deploiement).
//
// REGLES. Adresses zz-os-<objet>-<horodatage>@example.invalid uniquement, inscrites sur la liste
// de suppression AVANT tout envoi (aucun e-mail ne part chez Brevo). Aucun vrai compte, aucun
// compte de test de Fouka n'est touche. Tout ce qui est cree est supprime a la fin, et la
// suppression est verifiee. Environ 4 e-mails mis en file (tous supprimes), 1 appel reel a
// request-password-reset (son compteur par IP est remis a zero a la fin).
//
//   node livrables/SportVision-TV/tests/os-creation-compte.test.mjs
//   FONCTION_LOCALE=1 node livrables/SportVision-TV/tests/os-creation-compte.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY, ANON = env.SUPABASE_ANON_KEY, MGMT = env.SUPABASE_MANAGEMENT_TOKEN;
if (!SB || !KEY || !ANON || !MGMT) { console.log("Secrets Supabase absents de .env — test ignore."); process.exit(0); }
const REF = new URL(SB).hostname.split(".")[0];
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const RUN = Date.now();
const MDP = "Zz-essai-2026";
let n = 0;
const adresse = (objet) => `zz-os-${objet}-${RUN}${n++}@example.invalid`;
// Sans le domaine : l'adresse volontairement fautive du scenario 6 (« …@example », sans extension)
// est ACCEPTEE par une fonction anterieure au correctif, qui cree le compte. Elle doit etre
// nettoyee comme les autres.
const MOTIF = `zz-os-%-${RUN}%`;

// ── Outils ────────────────────────────────────────────────────────────────
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
async function suppression(email) {
  const r = await fetch(`${SB}/rest/v1/communication_suppressions`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ channel: "EMAIL", address: email.toLowerCase(), reason: "manual" }) });
  if (!r.ok) throw new Error("liste de suppression : " + r.status + " " + await r.text());
}
async function lien(type, email, data) {
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type, email, ...(data ? { data } : {}) }) });
  return r.json();
}
// Suit la redirection du lien Supabase comme le ferait le navigateur, et rend le fragment.
async function fragment(action_link) {
  const loc = (await fetch(action_link, { redirect: "manual" })).headers.get("location") || "";
  return loc.includes("#") ? loc.slice(loc.indexOf("#")) : "";
}
// Un collaborateur cree exactement comme le fait invite-collaborateur (generateLink invite).
async function collaborateur(objet, meta, { mdp = false } = {}) {
  const email = adresse(objet);
  await suppression(email);
  const l = await lien("invite", email, { prenom: "Zoé", nom: "Essai", ...meta });
  if (!l.action_link) throw new Error("lien d'invitation impossible : " + JSON.stringify(l).slice(0, 200));
  const c = { email, id: l.id || l.user?.id, action_link: l.action_link };
  if (mdp) {
    const acces = new URLSearchParams((await fragment(l.action_link)).slice(1)).get("access_token");
    const r = await fetch(`${SB}/auth/v1/user`, { method: "PUT", headers: { apikey: ANON, Authorization: "Bearer " + acces, "Content-Type": "application/json" }, body: JSON.stringify({ password: MDP }) });
    if (!r.ok) throw new Error("mot de passe : " + r.status);
    c.acces = acces;
  }
  return c;
}
async function majProfil(id, body) {
  const r = await fetch(`${SB}/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("profil : " + r.status);
}
async function connexion(email, password) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.status;
}

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? "\n       " + detail : ""}`); }
};

// ── Fonction locale (optionnelle) ─────────────────────────────────────────
let deno = null, URL_INVITE = `${SB}/functions/v1/invite-collaborateur`;
if (process.env.FONCTION_LOCALE === "1") {
  deno = spawn("deno", ["run", "--allow-net", "--allow-env", "--allow-read", "index.ts"], {
    cwd: new URL("../supabase/functions/invite-collaborateur/", import.meta.url).pathname,
    env: { ...process.env, SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: KEY }, stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch("http://localhost:8000/", { method: "OPTIONS" })).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  URL_INVITE = "http://localhost:8000/";
  console.log("invite-collaborateur : version du depot, executee en local");
}
async function inviter(jeton, corps) {
  const r = await fetch(URL_INVITE, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", ...(jeton ? { Authorization: "Bearer " + jeton } : {}) }, body: JSON.stringify(corps) });
  return { status: r.status, corps: await r.json().catch(() => ({})) };
}

// ── L'OS du depot, servi en local ─────────────────────────────────────────
const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((q, r) => (q.url.split("?")[0] === "/" ? r.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html) : r.writeHead(404).end()));
await new Promise((r) => srv.listen(0, r));
const OS = `http://localhost:${srv.address().port}/`;
const nav = await chromium.launch();

async function page({ largeur = 1440, hauteur = 900 } = {}) {
  const ctx = await nav.newContext({ viewport: { width: largeur, height: hauteur } });
  if (deno) await ctx.route(/\/functions\/v1\/invite-collaborateur$/, async (r) => {
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }, body: "ok" });
    await r.fulfill({ response: await r.fetch({ url: URL_INVITE }) });
  });
  const p = await ctx.newPage();
  p.erreurs = [];
  p.on("pageerror", (e) => p.erreurs.push(String(e).split("\n")[0]));
  p.on("console", (m) => { if (m.type() === "error") p.erreurs.push(m.text().slice(0, 160)); });
  return p;
}
// Servi en local, l'OS ne trouve ni son service worker (sw.js) ni ses icones : 404 sans rapport.
const vraies = (l) => l.filter((e) => !/ServiceWorker|bad HTTP response code \(404\)|favicon|status of 40[0-9]|manifest|React DevTools/i.test(e));
const etat = (p) => p.evaluate(() => ({
  ecran: [...document.querySelectorAll(".scr.on")].map((e) => e.id).join(","),
  modale: document.getElementById("sv-modal")?.classList.contains("on") ? (document.getElementById("sv-modal-ct")?.innerText || "").replace(/\s+/g, " ") : "",
  role: localStorage.getItem("sv_role"), tok: !!localStorage.getItem("sv_tok"),
  nom: document.getElementById("u-nm")?.textContent || "", nav: document.querySelectorAll("#sb-nav [onclick]").length,
  contenu: (document.getElementById("app-ct")?.innerText || "").trim().length,
  loginErr: document.getElementById("l-err")?.textContent || "",
  debordement: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll("#toast-wrap > *")].map((x) => x.textContent.trim()).join(" | "));
async function seConnecter(p, email, mdp) {
  await p.goto(OS, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1500);
  await p.fill("#l-email", email); await p.fill("#l-pass", mdp); await p.click("#l-btn");
  await p.waitForTimeout(5000);
}
async function remplirMdp(p, a, b = a) {
  await p.fill("#rec-pass1", a); await p.fill("#rec-pass2", b);
  await p.locator("#sv-modal-ct .btn.bp").click(); await p.waitForTimeout(4000);
}

const FOOT = (await sql("select id from poles where slug='football'"))[0]?.id;
const candidatures = [];

try {
  // ═══ 1. Un administrateur invite un photographe depuis l'ecran Equipe ═══
  console.log("\n1. Invitation depuis l'ecran Equipe (administrateur, invite-collaborateur reelle)");
  const admin = await collaborateur("admin", { role: "admin", pole_ids: [FOOT] }, { mdp: true });
  const pa = await page();
  await seConnecter(pa, admin.email, MDP);
  t("l'administrateur de test entre dans l'OS", (await etat(pa)).ecran === "s-app");
  await pa.evaluate(() => switchView("equipehub")); await pa.waitForTimeout(2500);
  const recrue = adresse("recrue");
  await suppression(recrue);
  await pa.evaluate(() => modalInviterCollaborateur()); await pa.waitForTimeout(600);
  await pa.fill("#fi-prenom", "Zoé"); await pa.fill("#fi-nom", "Recrue");
  await pa.fill("#fi-email", "  " + recrue.replace("zz-os", "Zz-OS") + " ");
  await pa.selectOption("#fi-role", "photo");
  const rep = pa.waitForResponse((r) => /invite-collaborateur/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 });
  await pa.dblclick("#fi-submit-btn");
  const corps1 = await (await rep).json();
  await pa.waitForTimeout(2500);
  const e1 = await etat(pa);
  t("un double clic ne part qu'en un seul appel", (await sql(`select count(*)::int n from notification_outbox where lower(recipient_email)='${recrue}'`))[0]?.n === 1);
  t("la fenetre montre le lien d'invitation (et pas seulement son titre)", (await pa.locator("#sv-modal textarea").count()) === 1, e1.modale.slice(0, 80));
  const fin = await pa.evaluate(() => (document.getElementById("sv-modal-ct")?.innerText || "").match(/Valable jusqu'au ([^\n]+)/)?.[1] || "");
  // Le lien vit 24 h (Auth > mailer_otp_exp = 86400 s depuis le 11/09). L'ecran affiche l'heure d'expiration ; la
  // fonction doit annoncer la meme chose (c'est ce qu'elle met dans l'e-mail).
  t("l'ecran affiche l'heure d'expiration", /\d{1,2} \S+ à \d{2}:\d{2}/.test(fin), `affiche « ${fin} »`);
  const duree = new Date(corps1.expires_at).getTime() - Date.now();
  t("la fonction annonce la duree reelle, 24 h (e-mail compris)", duree <= 86400e3 + 60e3 && duree >= 86400e3 - 300e3,
    `expires_at = ${corps1.expires_at} (version de la fonction anterieure au correctif ?)`);
  const prof = (await sql(`select p.role, p.prenom, p.email, (select string_agg(po.slug||':'||pa.role_pole, ',') from pole_affectations pa join poles po on po.id=pa.pole_id where pa.user_id=p.id) aff from profiles p where p.email='${recrue}'`))[0];
  t("profil cree : role photo, prenom, adresse en minuscules", prof?.role === "photo" && prof?.prenom === "Zoé", JSON.stringify(prof));
  t("affecte au pole Football", prof?.aff === "football:membre", prof?.aff);
  const file = (await sql(`select recipient_email, template_key, payload_json->>'invitation_url' u from notification_outbox where lower(recipient_email)='${recrue}'`))[0];
  t("e-mail d'invitation mis en file, gabarit auth.invitation", file?.template_key === "auth.invitation" && file?.u === corps1.invitation_url);
  t("adresse de la file en minuscules", file?.recipient_email === recrue, file?.recipient_email);
  await pa.evaluate(() => closeModal());

  // ═══ 2. La recrue clique son lien : fenetre obligatoire, puis arrivee ═══
  console.log("\n2. Premiere arrivee de la recrue (390 px)");
  const pr = await page({ largeur: 390, hauteur: 844 });
  const frag = await fragment(corps1.invitation_url);
  await pr.goto(OS + frag, { waitUntil: "domcontentloaded" }); await pr.waitForTimeout(5000);
  let e2 = await etat(pr);
  t("la fenetre du mot de passe s'ouvre", (await pr.locator("#rec-pass1").count()) === 1, e2.modale.slice(0, 80));
  t("pas de croix pour la fermer", !(await pr.locator("#sv-modal button[aria-label=Fermer]").isVisible()));
  await pr.keyboard.press("Escape"); await pr.waitForTimeout(600);
  t("Echap ne la ferme pas", (await pr.locator("#rec-pass1").count()) === 1);
  await pr.reload(); await pr.waitForTimeout(5000);
  e2 = await etat(pr);
  t("apres rechargement : la fenetre revient, l'OS reste ferme", (await pr.locator("#rec-pass1").count()) === 1 && e2.ecran !== "s-app", `ecran ${e2.ecran}`);
  await remplirMdp(pr, "Zz-1234");
  t("7 caracteres : refuse, en francais", /8 caractères/.test(await pr.locator("#rec-err").innerText()));
  await remplirMdp(pr, MDP);
  e2 = await etat(pr);
  t("mot de passe enregistre : elle entre dans l'OS", e2.ecran === "s-app", e2.ecran);
  t("avec SON role et SON prenom", e2.role === "photo" && /Zoé/.test(e2.nom), `${e2.role} / ${e2.nom}`);
  t("un ecran rempli, sans debordement horizontal", e2.contenu > 40 && !e2.debordement);
  await pr.reload(); await pr.waitForTimeout(5000);
  t("au rechargement suivant, plus de fenetre", (await etat(pr)).ecran === "s-app" && (await pr.locator("#rec-pass1").count()) === 0);
  t("aucune erreur JavaScript", vraies(pr.erreurs).length === 0, vraies(pr.erreurs).join(" / "));
  await pr.context().close();

  // ═══ 3. Connexion normale, et messages d'erreur ═══
  console.log("\n3. Connexion par le formulaire (1440 px) et messages");
  const pc = await page();
  await seConnecter(pc, "  " + recrue.toUpperCase() + " ", MDP);
  t("adresse en majuscules et espaces : connexion acceptee", (await etat(pc)).ecran === "s-app");
  await pc.evaluate(() => doLogout()); await pc.waitForTimeout(1500);
  await seConnecter(pc, recrue, "mauvais-mdp");
  t("mauvais mot de passe : message explicite", /mot de passe incorrect/i.test((await etat(pc)).loginErr), (await etat(pc)).loginErr);
  const desact = await collaborateur("desact", { role: "photo", pole_ids: [FOOT] }, { mdp: true });
  await majProfil(desact.id, { actif: false });
  await seConnecter(pc, desact.email, MDP);
  t("compte desactive : message explicite", /désactivé/.test((await etat(pc)).loginErr), (await etat(pc)).loginErr);
  const client = adresse("client");
  await suppression(client);
  await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: client, password: MDP, email_confirm: true }) });
  await seConnecter(pc, client, MDP);
  t("compte client (sans profil interne) : « pas acces a l'OS »", /pas accès à SportVision OS/.test((await etat(pc)).loginErr), (await etat(pc)).loginErr);
  await pc.context().close();

  // ═══ 4. Lien deja utilise ═══
  console.log("\n4. Lien clique une seconde fois");
  const p4 = await page();
  await p4.goto(OS + await fragment(corps1.invitation_url), { waitUntil: "domcontentloaded" }); await p4.waitForTimeout(4000);
  t("« Ce lien n'est plus valable », avec de quoi en redemander un", /plus valable/.test((await etat(p4)).modale) && /nouveau lien/i.test((await etat(p4)).modale));
  await p4.context().close();

  // ═══ 5. Renvoi d'un lien expire ═══
  console.log("\n5. Renvoi d'une invitation jamais utilisee (lien expire)");
  const tard = adresse("renvoi");
  await suppression(tard);
  const i1 = await inviter(admin.acces, { email: tard, prenom: "Zoé", nom: "Tard", role: "photo", pole_ids: [FOOT] });
  await sql(`update auth.users set confirmation_sent_at = now() - interval '25 hours', invited_at = now() - interval '25 hours' where email='${tard}'`);
  t("le lien d'origine, 25 h plus tard, est expire", /otp_expired/.test(await fragment(i1.corps.invitation_url)));
  const i2 = await inviter(admin.acces, { email: tard, prenom: "Zoé", nom: "Tard", role: "photo", pole_ids: [FOOT] });
  t("une nouvelle invitation renvoie un NOUVEAU lien", i2.corps.renvoye === true && !!i2.corps.invitation_url, JSON.stringify(i2.corps).slice(0, 120));
  t("ce nouveau lien fonctionne", /access_token/.test(i2.corps.invitation_url ? await fragment(i2.corps.invitation_url) : ""));
  t("toujours un seul compte pour cette adresse", (await sql(`select count(*)::int n from auth.users where email='${tard}'`))[0]?.n === 1);
  const i3 = await inviter(admin.acces, { email: recrue, prenom: "Zoé", nom: "Recrue", role: "photo", pole_ids: [FOOT] });
  t("compte deja active : pas de nouveau lien, raison donnee", i3.corps.already_existed === true && i3.corps.deja_active === true && !i3.corps.invitation_url, JSON.stringify(i3.corps));

  // ═══ 6. Qui a le droit d'inviter (verifie par la fonction, pas par un bouton) ═══
  console.log("\n6. Droits d'invitation, cote serveur");
  const cible = (role, extra = {}) => ({ email: adresse("refus"), prenom: "Zz", nom: "Refus", role, pole_ids: [FOOT], ...extra });
  t("sans jeton : 401", (await inviter(null, cible("photo"))).status === 401);
  const photo = await collaborateur("appelant-photo", { role: "photo", pole_ids: [FOOT] }, { mdp: true });
  t("un photographe : 403", (await inviter(photo.acces, cible("photo"))).status === 403);
  const sec = await collaborateur("appelant-sec", { role: "sec", pole_ids: [FOOT] }, { mdp: true });
  t("la secretaire ne cree pas de comptable : 403", (await inviter(sec.acces, cible("compta"))).status === 403);
  t("la secretaire ne nomme pas de Responsable de pole : 403", (await inviter(sec.acces, cible("photo", { responsable_pole_ids: [FOOT] }))).status === 403);
  const secOff = await collaborateur("appelant-desact", { role: "sec", pole_ids: [FOOT] }, { mdp: true });
  await majProfil(secOff.id, { actif: false });
  // 401 ou 403 : depuis migration-comptes-os-v2, la desactivation supprime les sessions, donc
  // Supabase rejette le jeton (401) avant meme que la fonction lise `actif` (403). Les deux
  // veulent dire « refuse » ; seul un 2xx serait un echec.
  const rOff = await inviter(secOff.acces, cible("photo"));
  t("une secretaire desactivee ne cree plus de compte : 401/403", rOff.status === 401 || rOff.status === 403, `HTTP ${rOff.status} ${JSON.stringify(rOff.corps).slice(0, 100)}`);
  const faute = `zz-os-faute-${RUN}@example`;
  await suppression(faute);
  t("adresse sans extension refusee, en francais", /invalide/i.test((await inviter(admin.acces, cible("photo", { email: faute }))).corps.error || ""));

  // ═══ 7. Recrutement : la secretaire cree une recrue en integration ═══
  console.log("\n7. Recrutement > Creer le collaborateur (secretaire)");
  const candEmail = adresse("cand");
  await suppression(candEmail);
  const cand = (await (await fetch(`${SB}/rest/v1/recruitment_applications`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ poste: "photographe", prenom: "Zoé", nom: "Candidate", email: candEmail, telephone: "0600000000", ville: "Sens", statut: "retenu", pole_id: FOOT }) })).json())[0];
  candidatures.push(cand.id);
  const ps = await page();
  await seConnecter(ps, sec.email, MDP);
  await ps.evaluate(() => switchView("recrutement")); await ps.waitForTimeout(3500);
  await ps.evaluate((id) => modalRecrutCreerCollaborateur(id), cand.id); await ps.waitForTimeout(600);
  const repC = ps.waitForResponse((r) => /invite-collaborateur/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 });
  await ps.click("#rcc-submit-btn");
  const corpsC = await (await repC).json();
  await ps.waitForTimeout(1200);
  const profC = (await sql(`select actif, onboarding_started_at is not null onb, telephone from profiles where email='${candEmail}'`))[0];
  t("la fiche demarre en integration (acces ferme), meme creee par la secretaire", profC?.actif === false && profC?.onb === true, JSON.stringify(profC));
  t("les coordonnees de la candidature sont reprises", profC?.telephone === "0600000000");
  t("l'ecran dit la verite sur l'integration", /onboarding démarré/.test(await toasts(ps)) === (profC?.actif === false), await toasts(ps));
  await ps.context().close();
  const pk = await page({ largeur: 390, hauteur: 844 });
  await pk.goto(OS + await fragment(corpsC.invitation_url), { waitUntil: "domcontentloaded" }); await pk.waitForTimeout(4500);
  t("la recrue en integration peut choisir son mot de passe", (await pk.locator("#rec-pass1").count()) === 1, (await etat(pk)).modale.slice(0, 80));
  if (await pk.locator("#rec-pass1").count()) {
    await remplirMdp(pk, MDP);
    const ek = await etat(pk);
    t("... sans entrer dans l'OS, et on lui dit pourquoi", ek.ecran !== "s-app" && !ek.tok && /intégration/.test(ek.modale), ek.modale.slice(0, 80));
    await seConnecter(pk, candEmail, MDP);
    t("en se connectant avant l'ouverture : « acces ouvert a la fin de l'integration »", /intégration/.test((await etat(pk)).loginErr), (await etat(pk)).loginErr);
  }
  await pk.context().close();

  // ═══ 8. Mot de passe oublie ═══
  console.log("\n8. Mot de passe oublie (request-password-reset reelle)");
  const po = await page({ largeur: 390, hauteur: 844 });
  await po.goto(OS, { waitUntil: "domcontentloaded" }); await po.waitForTimeout(1500);
  await po.click("text=Mot de passe oublié ?"); await po.waitForTimeout(400);
  await po.fill("#reset-email", recrue); await po.click("text=Envoyer le lien"); await po.waitForTimeout(4000);
  const reset = (await sql(`select payload_json->>'reset_url' u from notification_outbox where lower(recipient_email)='${recrue}' and template_key='auth.password_reset'`))[0]?.u;
  t("e-mail de reinitialisation mis en file", !!reset);
  await po.context().close();
  if (reset) {
    // Nouvel onglet, comme depuis la boite mail : dans l'onglet deja ouvert sur l'OS, changer
    // seulement le fragment ne recharge pas la page.
    const pm = await page({ largeur: 390, hauteur: 844 });
    await pm.goto(OS + await fragment(reset), { waitUntil: "domcontentloaded" }); await pm.waitForTimeout(4500);
    t("le lien ouvre « Definir un nouveau mot de passe »", /nouveau mot de passe/i.test((await etat(pm)).modale), (await etat(pm)).modale.slice(0, 80));
    await remplirMdp(pm, "Zz-nouveau-2026");
    t("nouveau mot de passe : elle entre", (await etat(pm)).ecran === "s-app");
    t("l'ancien ne marche plus, le nouveau oui", (await connexion(recrue, MDP)) === 400 && (await connexion(recrue, "Zz-nouveau-2026")) === 200);
    await pm.context().close();
  }
  await pa.context().close();
} finally {
  await nav.close();
  srv.close();
  if (deno) deno.kill();

  // ═══ Nettoyage, verifie ═══
  console.log("\nNettoyage");
  const ids = await sql(`select id from auth.users where email like '${MOTIF}'`);
  if (candidatures.length) await sql(`delete from activity_log where entity_type='recruitment_application' and entity_id in (${candidatures.map((i) => `'${i}'`).join(",")}); delete from recruitment_applications where id in (${candidatures.map((i) => `'${i}'`).join(",")});`);
  for (const { id } of Array.isArray(ids) ? ids : []) {
    await sql(`delete from notifications where destinataire_id='${id}'`);
    await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  }
  await sql(`delete from notification_attempts where outbox_id in (select id from notification_outbox where lower(recipient_email) like '${MOTIF}');
    delete from notification_outbox where lower(recipient_email) like '${MOTIF}';
    delete from communication_suppressions where address like '${MOTIF}';
    delete from guest_rate_limits where identifiant like 'pwreset:email:${MOTIF}';
    delete from guest_rate_limits where identifiant like 'pwreset:ip:%' and created_at >= to_timestamp(${Math.floor(RUN / 1000)});`);
  const reste = (await sql(`select
      (select count(*)::int from auth.users where email like '${MOTIF}') auth,
      (select count(*)::int from profiles where email like '${MOTIF}') profils,
      (select count(*)::int from pole_affectations pa where not exists (select 1 from auth.users u where u.id=pa.user_id)) affectations_orphelines,
      (select count(*)::int from notification_outbox where lower(recipient_email) like '${MOTIF}') file_envoi,
      (select count(*)::int from communication_suppressions where address like '${MOTIF}') suppressions,
      (select count(*)::int from recruitment_applications where email like '${MOTIF}') candidatures`))[0] || {};
  t("plus rien du test en base", Object.values(reste).every((v) => v === 0), JSON.stringify(reste));
  console.log(`\n${ok}/${ok + ko} verifications passees.`);
  process.exit(ko ? 1 : 0);
}
