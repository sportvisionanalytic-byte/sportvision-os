// Le parcours d'un president de club, du lien d'invitation au clic sur chaque ecran.
//
// POURQUOI CE TEST. Aucun compte president n'existe en production : `club_members` ne portait que
// deux lignes, toutes deux « admin ». Le parcours president etait donc entierement non verifie,
// alors que c'est la premiere personne qu'un nouveau club fait entrer. L'audit du 10/09/2026 le
// listait comme bloquant.
//
// CE QU'IL FAIT. Il cree une vraie invitation, ouvre le vrai lien, cree un vrai compte, entre dans
// l'espace, puis CLIQUE sur chaque entree du menu. Un ecran qui repond 200 mais affiche « une
// erreur est survenue » compte comme casse : on lit ce qui s'affiche, pas le code HTTP.
//
// PROPRETE. Tout est cree sur le club de test de Fouka (Villeneuve 340 SC) avec une adresse en
// .invalid, et supprime a la fin — compte, rattachement, invitation. La suppression est verifiee ;
// si elle echoue, le test le dit au lieu de laisser un compte fantome dans un club reel.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, ANON, enTeteAdmin, jeton } from "./_session-os.mjs";

const CLUB = "Villeneuve 340 SC";
const EMAIL = `zz-president-${Date.now()}@example.invalid`;
const MOTDEPASSE = "ZzPresident!2026-Test";
const { t, bilan } = rapporteur();

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const authApi = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

const club = (await (await api(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB)}`)).json())[0];
if (!club) { console.log(`Club ${CLUB} introuvable — test ignore.`); process.exit(0); }

// ── L'invitation, preparee comme le ferait le club ──────────────────────────
const invitant = (await (await api(
  `club_members?select=user_id&club_id=eq.${club.id}&role=eq.admin&status=eq.actif&limit=1`)).json())[0];
if (!invitant) { console.log("Aucun dirigeant pour inviter — test ignore."); process.exit(0); }

// L'appel se fait avec le JETON du dirigeant, pas avec la cle de service.
// preparer_invitation_club verifie qui invite : appelee en service_role, auth.uid() est nul et la
// fonction repond « Vous n'etes pas autorise a inviter sur ce club ». On emprunte donc le chemin
// de son ecran, comme partout ailleurs dans cette suite.
const invitantEmail = (await (await authApi(`admin/users/${invitant.user_id}`)).json()).email;
const jetonInvitant = await jeton(invitantEmail);
if (!jetonInvitant) { console.log("Jeton du dirigeant indisponible — test ignore."); process.exit(0); }

const prepare = await fetch(`${SB}/rest/v1/rpc/preparer_invitation_club`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${jetonInvitant.acces}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    p_club_id: club.id, p_email: EMAIL, p_role: "president",
    p_prenom: "ZZ", p_nom: "President", p_telephone: null, p_teams: [],
  }),
});
t("l'invitation se prepare", prepare.status < 300, `HTTP ${prepare.status} — ${(await prepare.text()).slice(0, 140)}`);

const invit = (await (await api(`club_invitations?select=token,role,statut&email=eq.${encodeURIComponent(EMAIL)}`)).json())[0];
t("elle porte bien le role president", invit?.role === "president", JSON.stringify(invit || {}));
if (!invit?.token) { console.log("Pas de jeton — arret."); process.exit(bilan() ? 1 : 0); }

const navigateur = await chromium.launch();
const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });

let compteId = null;
try {
  // ── Le lien ───────────────────────────────────────────────────────────────
  await page.goto(`${CP}/clubplus/rejoindre?token=${invit.token}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const accueil = (await page.evaluate(() => document.body.innerText)) || "";
  t("le lien annonce le club et le role", accueil.includes(CLUB) && /pr[ée]sident/i.test(accueil),
    accueil.slice(0, 160));

  // ── La creation du compte ─────────────────────────────────────────────────
  await page.locator("button", { hasText: "Créer mon accès" }).first().click();
  await page.waitForTimeout(2500);
  await page.locator("input[type=email]").first().fill(EMAIL);
  await page.locator("input[type=password]").first().fill(MOTDEPASSE);
  await page.locator("button", { hasText: /Créer mon espace/i }).first().click();
  await page.waitForTimeout(11000);

  const apresCreation = (await page.evaluate(() => document.body.innerText)) || "";
  t("le compte est cree et la suite est expliquee", /confirmez votre adresse|compte cr[ée]{2}/i.test(apresCreation),
    apresCreation.slice(-220));

  const compte = (await (await authApi(`admin/users?filter=${encodeURIComponent(EMAIL)}`)).json())?.users?.[0];
  t("le compte existe cote authentification", !!compte?.id);
  compteId = compte?.id ?? null;

  // On simule le clic sur le lien de confirmation, que .invalid ne peut pas recevoir.
  if (compteId) {
    await authApi(`admin/users/${compteId}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });
  }

  // ── L'entree dans l'espace ────────────────────────────────────────────────
  await page.goto(`${CP}/clubplus/rejoindre?token=${invit.token}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.locator("button", { hasText: "J'ai déjà un compte" }).first().click();
  await page.waitForTimeout(2000);
  await page.locator("input[type=email]").first().fill(EMAIL);
  await page.locator("input[type=password]").first().fill(MOTDEPASSE);
  await page.locator("button", { hasText: /Se connecter et rejoindre/i }).first().click();
  await page.waitForTimeout(13000);

  t("le president arrive dans l'espace du club", /dashboard|clubplus/.test(page.url()) && !/rejoindre/.test(page.url()),
    page.url().replace(CP, ""));
  const bureau = (await page.evaluate(() => document.body.innerText)) || "";
  t("l'espace affiche bien SON club", bureau.includes(CLUB), bureau.slice(0, 160));

  // L'assistant d'onboarding, s'il s'ouvre, ne doit pas emprisonner la personne.
  const assistant = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
  if (await assistant.count()) {
    const plusTard = assistant.locator("button", { hasText: "Terminer plus tard" }).first();
    t("l'assistant d'onboarding se laisse ecarter", await plusTard.count() > 0,
      "aucun bouton pour sortir de la modale plein ecran");
    if (await plusTard.count()) { await plusTard.click({ force: true }); await page.waitForTimeout(2500); }
  }

  // ── Chaque entree du menu ─────────────────────────────────────────────────
  const entrees = await page.evaluate(() =>
    [...document.querySelectorAll("nav a, aside a")].map((a) => a.textContent.trim()).filter(Boolean));
  t("le menu du president est renseigne", entrees.length >= 4, `${entrees.length} entree(s) : ${entrees.join(" | ")}`);
  console.log(`       menu : ${entrees.join(" | ")}`);

  const casses = [];
  for (const entree of entrees) {
    const lien = page.locator("nav a, aside a").filter({ hasText: entree }).first();
    if (!(await lien.count())) continue;
    await lien.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const texte = (await page.evaluate(() => document.body.innerText)) || "";
    // Un ecran qui repond mais affiche une erreur compte comme casse.
    const enErreur = /une erreur est survenue|impossible de charger|something went wrong|application error/i.test(texte);
    const vide = texte.replace(/\s+/g, " ").length < 400;
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    if (enErreur || vide || deborde) {
      casses.push(`${entree}${enErreur ? " (erreur affichee)" : ""}${vide ? " (page vide)" : ""}${deborde ? " (deborde)" : ""}`);
    }
  }
  t(`les ${entrees.length} ecrans du president s'ouvrent sans erreur`, casses.length === 0, casses.join("\n       "));

  // ── Son perimetre, mesure en base ─────────────────────────────────────────
  if (compteId) {
    const membre = (await (await api(`club_members?select=club_id,role,status&user_id=eq.${compteId}`)).json());
    t("il est membre du bon club, avec le bon role",
      membre?.length === 1 && membre[0].club_id === club.id && membre[0].role === "president" && membre[0].status === "actif",
      JSON.stringify(membre || []));
  }

  t("aucune erreur JavaScript sur tout le parcours", vraiesErreursCP(erreurs).length === 0,
    vraiesErreursCP(erreurs).slice(0, 5).join("\n       "));
} finally {
  await navigateur.close();

  // ── Nettoyage, verifie ────────────────────────────────────────────────────
  if (compteId) {
    await api(`club_members?user_id=eq.${compteId}`, { method: "DELETE" });
    await authApi(`admin/users/${compteId}`, { method: "DELETE" });
  }
  await api(`club_invitations?email=eq.${encodeURIComponent(EMAIL)}`, { method: "DELETE" });

  const restes = compteId
    ? (await (await api(`club_members?select=user_id&user_id=eq.${compteId}`)).json())
    : [];
  const invitRestante = await (await api(`club_invitations?select=id&email=eq.${encodeURIComponent(EMAIL)}`)).json();
  t("le compte de test ne laisse aucune trace dans le club",
    (restes?.length ?? 0) === 0 && (invitRestante?.length ?? 0) === 0,
    `${restes?.length ?? 0} rattachement(s), ${invitRestante?.length ?? 0} invitation(s) — A NETTOYER A LA MAIN`);
}

process.exit(bilan() ? 1 : 0);
