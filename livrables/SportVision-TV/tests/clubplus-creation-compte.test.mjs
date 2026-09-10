// Toutes les créations de compte et premières connexions de Club+, rejouées dans un vrai navigateur.
//
// POURQUOI CE TEST. « À chaque fois qu'il y a la création d'un compte il y a un bug » (Fouka,
// 10/09/2026). L'audit du jour a trouvé, sur la production : un lien de confirmation qui renvoyait
// le coach invité sur Connect, des comptes existants invités à « vérifier leurs e-mails » qui ne
// partaient jamais, des refus Supabase affichés en anglais, un bouton actif à 6 caractères quand le
// serveur en exige 8, aucun moyen de changer de compte, une activation perdue quand le lien de
// confirmation est ouvert sur un autre appareil. Chacun de ces défauts vivait dans un écran que
// personne n'avait rejoué de bout en bout. Ce test les rejoue tous.
//
// CE QU'IL COUVRE
//   A  /rejoindre, pour CHACUN des 11 rôles invitables (compte existant) : bon club, bon rôle, bon
//      périmètre d'équipes, menu cliqué écran par écran (TOUS_LES_ECRANS=1).
//   B  /rejoindre, création d'un accès (nouveau compte) jusqu'à l'entrée dans le club.
//   C  /rejoindre, cas limites : adresse déjà inscrite, mauvais mot de passe, adresse non confirmée,
//      mauvais compte connecté, invitation révoquée / expirée / déjà acceptée / inconnue, e-mails
//      plafonnés (429), double clic, 390 px, membre d'un autre espace, compte staff de l'OS.
//   D  Connexion, lien de confirmation en échec, mot de passe oublié → réinitialisation → connexion.
//   E  /signup-free (Club+ Gratuit) : nouveau compte, lien ouvert sur un autre appareil, compte existant.
//   F  /activation (lien d'activation d'un club) : nouveau compte, compte existant, lien déjà utilisé.
//   G  /org-activation (les 6 autres types de structure) : compte existant, lien expiré.
//   H  /signup/request (demande d'ouverture) → validation SportVision → activation → entrée.
//   I  clubplus-invite (création directe d'un accès) : un CM ne crée pas d'administrateur ; le coach
//      créé en direct entre dans son club.
//
// COMMENT IL TESTE SANS ÉPUISER LES E-MAILS. Le projet n'a droit qu'à 15 e-mails d'authentification
// par heure, partagés avec les vrais clubs. Par défaut (ENVOIS_REELS=0), aucune inscription ne part
// réellement : la requête de l'écran est interceptée, son contenu vérifié (adresse de retour, données
// du compte), puis le compte est créé par l'API d'administration, qui n'envoie rien. Un compte déjà
// existant, lui, passe toujours par le vrai Supabase : il n'envoie aucun e-mail dans ce cas.
// Avec ENVOIS_REELS=n, les n premières inscriptions partent pour de vrai, et le clic sur le lien
// reçu est simulé à l'identique (même jeton, même adresse de retour) : c'est le seul moyen de
// traverser le vrai échange PKCE de /auth/callback.
//
// TESTER UN CORRECTIF AVANT DE LE DÉPLOYER. LOCAL=http://127.0.0.1:3400 sert l'app locale SOUS
// l'origine de production (le navigateur croit être sur clubplus.sportvision-an.fr) : mêmes
// cookies, même adresse de retour acceptée par Supabase, même base.
//
//   node livrables/SportVision-TV/tests/clubplus-creation-compte.test.mjs
//   SEULEMENT=A,C LOCAL=http://127.0.0.1:3400 ENVOIS_REELS=2 node livrables/SportVision-TV/tests/clubplus-creation-compte.test.mjs
//
// PROPRETÉ. Adresses zz-clubplus-…@example.invalid uniquement, club de test « Villeneuve 340 SC ».
// Tout ce qui est créé (comptes, rattachements, invitations, clubs, organisations, fiches clients,
// jetons, demandes, notifications, journal, file d'e-mails) est supprimé à la fin, et le test VÉRIFIE
// qu'il ne reste rien. Les e-mails que l'application met en file pour ces adresses sont bloqués
// d'avance par la liste de suppression : ils ne partent jamais.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, ANON, enTeteAdmin, env } from "./_session-os.mjs";

const LOCAL = (process.env.LOCAL || "").replace(/\/+$/, "");
const ENVOIS_MAX = Number(process.env.ENVOIS_REELS || 0);
const SEULEMENT = (process.env.SEULEMENT || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const TOUS_LES_ECRANS = process.env.TOUS_LES_ECRANS === "1";
const CLUB_NOM = "Villeneuve 340 SC";
const T0 = Date.now();
const MDP = "ZzClubplus!2026-Test";
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const { t, bilan } = rapporteur();
const doit = (lettre) => SEULEMENT.length === 0 || SEULEMENT.includes(lettre);
let envoisFaits = 0;

// Toute phrase qu'une personne ne devrait jamais lire dans Club+.
const ANGLAIS_OU_TECHNIQUE =
  /invalid login|email not confirmed|rate limit|password should|already registered|for security purposes|failed to fetch|non-2xx|edge function|jwt|user not found|unexpected error|violates|duplicate key|null value/i;

// ── Traces de tout ce que le test crée, pour le nettoyage ────────────────────
const traces = { emails: new Set(), clubs: new Set(), orgs: new Set(), clients: new Set() };
const adresse = (objet) => {
  const e = `zz-clubplus-${objet}-${T0}@example.invalid`;
  traces.emails.add(e);
  return e;
};

// ── Accès aux API ───────────────────────────────────────────────────────────
const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, {
    ...opts,
    headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) },
  });
const lire = async (chemin) => {
  const r = await api(chemin);
  return r.ok ? r.json() : [];
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

// L'API Management ne sert qu'à LIRE ce que PostgREST n'expose pas (le jeton de confirmation d'un
// compte, pour simuler le clic sur l'e-mail). Elle s'exécute en postgres : elle ne prouve rien sur
// des droits, et aucune vérification de droits de ce test ne passe par elle.
async function sqlLecture(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  return r.json();
}

async function compteParEmail(email) {
  const d = await (await auth(`admin/users?filter=${encodeURIComponent(email)}&per_page=50`)).json();
  return (d?.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function creerCompte(email, { confirme = true, mdp = MDP } = {}) {
  traces.emails.add(email.toLowerCase());
  const r = await auth("admin/users", { method: "POST", body: JSON.stringify({ email, password: mdp, email_confirm: confirme }) });
  const d = await r.json();
  if (!d.id) throw new Error(`création du compte ${email} impossible : ${JSON.stringify(d).slice(0, 160)}`);
  return d.id;
}

async function jetonMdp(email, mdp = MDP) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: mdp }),
  });
  return (await r.json()).access_token || null;
}

async function rpc(jeton, fn, body) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const texte = await r.text();
  let data = null;
  try { data = JSON.parse(texte); } catch { data = texte; }
  return { status: r.status, data };
}

// Les e-mails que l'application met en file pour ces adresses de test ne doivent jamais partir :
// dispatch-notifications consulte la liste de suppression avant chaque envoi.
// 10/09/2026 : `reason` n'accepte que hard_bounce, complaint, unsubscribe ou manual (contrainte
// communication_suppressions_reason_check). L'ancien libellé libre était refusé en silence : aucune
// adresse n'était réellement bloquée, et les e-mails mis en file partaient chez Brevo. L'échec
// arrête désormais le test au lieu de passer inaperçu.
async function bloquerEnvois(email) {
  const r = await api("communication_suppressions", {
    method: "POST",
    body: JSON.stringify({ channel: "EMAIL", address: email.toLowerCase(), reason: "manual" }),
  });
  if (!r.ok && r.status !== 409) throw new Error(`liste de suppression refusée pour ${email} : HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}

// ── Navigateur ──────────────────────────────────────────────────────────────
// LOCAL : chaque requête vers l'origine de production est servie par l'app locale. Les redirections
// qu'elle émet (callback, middleware) sont réécrites vers l'origine de production, pour que le
// navigateur ne la quitte jamais.
async function brancherLocal(ctx) {
  if (!LOCAL) return;
  await ctx.route(`${CP}/**`, async (route) => {
    const url = route.request().url().replace(CP, LOCAL);
    // Next refuse une Server Action dont l'en-tête `origin` ne correspond pas à l'hôte qui la
    // reçoit (protection CSRF) : vue du serveur local, l'origine doit donc être la sienne.
    const envoyes = { ...route.request().headers() };
    if (envoyes.origin) envoyes.origin = LOCAL;
    try {
      // Une seconde tentative sur coupure réseau (11/09/2026) : `next start` referme ses connexions
      // inactives au bout de 5 s, et une requête qui tombe sur une connexion en train de se fermer
      // revient en ECONNRESET. Trois passages de suite ont perdu un parcours entier pour cette
      // seule raison, sans rapport avec l'application. Une vraie panne du serveur échoue deux fois.
      const rep = await route.fetch({ url, headers: envoyes, maxRedirects: 0 })
        .catch((e) => (/ECONNRESET|socket hang up/i.test(String(e)) ? route.fetch({ url, headers: envoyes, maxRedirects: 0 }) : Promise.reject(e)));
      const recus = { ...rep.headers() };
      if (recus.location) recus.location = recus.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, CP);
      // Une redirection servie par route.fulfill est suivie par le navigateur SANS repasser par
      // cette interception : la page d'arrivée viendrait de la production. On la rejoue donc en
      // redirection côté page (cookies de la réponse conservés), qui, elle, est interceptée.
      if (rep.status() >= 300 && rep.status() < 400 && recus.location) {
        const cible = new URL(recus.location, route.request().url()).href;
        delete recus.location;
        delete recus["content-length"];
        return route.fulfill({
          status: 200,
          headers: { ...recus, "content-type": "text/html; charset=utf-8" },
          body: `<!doctype html><script>location.replace(${JSON.stringify(cible)})</script>`,
        });
      }
      await route.fulfill({ response: rep, headers: recus });
    } catch (e) {
      console.log(`       (serveur local injoignable pour ${url.slice(0, 90)} : ${String(e).split("\n")[0].slice(0, 160)})`);
      await route.abort().catch(() => {});
    }
  });
}

// Intercepte POST /auth/v1/signup. mode : "simule" (défaut, aucun e-mail), "reel" (dans la limite
// ENVOIS_REELS), "429" (le plafond d'e-mails du projet, reproduit à l'identique).
async function surveillerInscriptions(ctx, journal, mode = "simule") {
  await ctx.route(`${SB}/auth/v1/signup**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    let corps = {};
    try { corps = JSON.parse(req.postData() || "{}"); } catch { corps = {}; }
    const entree = { redirect: u.searchParams.get("redirect_to"), email: corps.email, data: corps.data || {}, pkce: Boolean(corps.code_challenge), reel: false };
    journal.inscriptions.push(entree);

    if (mode === "429") {
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }),
      });
    }
    const existant = corps.email ? await compteParEmail(corps.email) : null;
    // Compte déjà confirmé : le vrai Supabase ne crée rien et n'envoie rien. On le laisse répondre.
    if (existant?.email_confirmed_at) return route.continue();
    if (mode === "reel" && !existant && envoisFaits < ENVOIS_MAX) {
      envoisFaits++;
      entree.reel = true;
      traces.emails.add(String(corps.email).toLowerCase());
      return route.continue();
    }
    // Simulé : le compte est créé par l'API d'administration (aucun e-mail), non confirmé, avec
    // exactement les métadonnées que l'écran a envoyées. La réponse imite celle de Supabase.
    let id = existant?.id;
    if (!id) {
      traces.emails.add(String(corps.email).toLowerCase());
      const r = await auth("admin/users", {
        method: "POST",
        body: JSON.stringify({ email: corps.email, password: corps.password, email_confirm: false, user_metadata: corps.data || {} }),
      });
      id = (await r.json()).id;
    }
    const maintenant = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id, aud: "authenticated", role: "authenticated", email: String(corps.email).toLowerCase(), phone: "",
        confirmation_sent_at: maintenant, app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: corps.data || {},
        identities: [{ identity_id: id, id, user_id: id, provider: "email", identity_data: { email: corps.email, sub: id }, created_at: maintenant, updated_at: maintenant }],
        created_at: maintenant, updated_at: maintenant, is_anonymous: false,
      }),
    });
  });
}

// FONCTIONS_LOCALES=clubplus-activate=http://127.0.0.1:8101,… : les appels du navigateur à ces edge
// functions sont servis par une copie locale du code du dépôt (lancée avec deno contre la vraie
// base). C'est la seule façon de vérifier un correctif de fonction AVANT son déploiement.
const FONCTIONS_LOCALES = Object.fromEntries(
  (process.env.FONCTIONS_LOCALES || "").split(",").filter((s) => s.includes("=")).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
);
async function brancherFonctions(ctx) {
  for (const [nom, cible] of Object.entries(FONCTIONS_LOCALES)) {
    await ctx.route(`${SB}/functions/v1/${nom}`, async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "ok" });
      const entetes = Object.fromEntries(
        Object.entries(await req.allHeaders()).filter(([k]) => !/^(host|content-length|connection|origin|referer|cookie)$/i.test(k)),
      );
      const r = await fetch(cible, { method: req.method(), headers: entetes, body: req.postData() ?? undefined });
      await route.fulfill({ status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await r.text() });
    });
  }
}

async function ouvrir(nav, { largeur = 1440, hauteur = 900, inscriptions = "simule" } = {}) {
  const ctx = await nav.newContext({ viewport: { width: largeur, height: hauteur }, locale: "fr-FR" });
  await brancherLocal(ctx);
  await brancherFonctions(ctx);
  const journal = { erreurs: [], inscriptions: [] };
  await surveillerInscriptions(ctx, journal, inscriptions);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => journal.erreurs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") journal.erreurs.push(m.text().slice(0, 200)); });
  // La console dit « 500 » sans dire quelle requête : on la nomme.
  page.on("response", (r) => { if (r.status() >= 500) journal.erreurs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 170)}`); });
  return { ctx, page, journal };
}

const texte = async (page) => ((await page.evaluate(() => document.body?.innerText || "").catch(() => "")) || "").replace(/\s+/g, " ");
const deborde = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
const attendre = (page, ms) => page.waitForTimeout(ms);
async function aller(page, chemin, ms = 6000) {
  await page.goto(CP + chemin, { waitUntil: "domcontentloaded" });
  await attendre(page, ms);
}
const bouton = (page, libelle) => page.locator("button", { hasText: libelle }).first();

// Le clic sur le lien de l'e-mail de confirmation, à l'identique : même jeton, même adresse de retour.
async function lienDeConfirmation(email, redirect) {
  const d = await sqlLecture(`select confirmation_token from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}')`);
  const jeton = d?.[0]?.confirmation_token;
  if (!jeton) return null;
  return `${SB}/auth/v1/verify?token=${encodeURIComponent(jeton)}&type=signup&redirect_to=${encodeURIComponent(redirect || "")}`;
}

// Suit un lien Supabase (/auth/v1/verify) comme le navigateur le ferait, puis ouvre la page où il
// renvoie. On lit la redirection côté Node plutôt que de laisser le navigateur la suivre : une
// redirection venue du réseau n'est pas repassée par l'interception LOCAL, et la page d'arrivée
// serait alors celle de la production (constaté : /auth/callback servi par l'ancienne version).
async function suivreLienSupabase(page, lien) {
  const r = await fetch(lien, { redirect: "manual" });
  const loc = r.headers.get("location");
  if (!loc) throw new Error(`le lien Supabase ne redirige pas (HTTP ${r.status})`);
  await page.goto(loc, { waitUntil: "domcontentloaded" });
}

// ── Mise en place : un propriétaire de test pour le club de test ─────────────
async function preparerClub() {
  const club = (await lire(`clubs?select=id,nom&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
  if (!club) return null;
  const email = adresse("owner");
  const id = await creerCompte(email);
  const r = await api("club_members", {
    method: "POST",
    body: JSON.stringify({ user_id: id, club_id: club.id, role: "admin", status: "actif", prenom: "ZZ", nom: "Owner test" }),
  });
  if (!r.ok) throw new Error(`rattachement du propriétaire de test impossible : ${await r.text()}`);
  const jeton = await jetonMdp(email);
  const equipes = (await lire(`club_teams?select=name&club_id=eq.${club.id}&order=name`)).map((e) => e.name);
  return { ...club, owner: { email, id, jeton }, equipes };
}

async function inviter(club, email, role, { teams = [], prenom = "ZZ", nom = "Invite" } = {}) {
  const r = await rpc(club.owner.jeton, "preparer_invitation_club", {
    p_club_id: club.id, p_email: email, p_role: role, p_prenom: prenom, p_nom: nom, p_telephone: null, p_teams: teams,
  });
  if (r.status >= 300) throw new Error(`invitation ${role} refusée : ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

async function membre(userId, clubId) {
  return (await lire(`club_members?select=role,status,teams&user_id=eq.${userId}&club_id=eq.${clubId}`))[0] || null;
}

// Clique chaque entrée du menu ; un écran qui répond mais affiche une erreur compte comme cassé.
async function cliquerLeMenu(page) {
  const entrees = await page.evaluate(() =>
    [...document.querySelectorAll("nav a, aside a")].map((a) => a.textContent.trim()).filter(Boolean));
  if (!TOUS_LES_ECRANS) return { entrees, casses: [] };
  const casses = [];
  for (const entree of [...new Set(entrees)]) {
    const lien = page.locator("nav a, aside a").filter({ hasText: entree }).first();
    if (!(await lien.count())) continue;
    await lien.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await attendre(page, 2200);
    const tx = await texte(page);
    const enErreur = /une erreur est survenue|impossible de charger|something went wrong|application error|acc[eè]s refus[ée]/i.test(tx);
    if (enErreur || tx.length < 300 || (await deborde(page))) casses.push(`${entree}${enErreur ? " (erreur)" : ""}${tx.length < 300 ? " (vide)" : ""}`);
  }
  return { entrees, casses };
}

// Ferme l'assistant d'onboarding s'il s'ouvre (voir _session-clubplus.mjs § ouvrirLeClub).
async function ecarterAssistant(page) {
  const assistant = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
  if (await assistant.count()) {
    const plusTard = assistant.locator("button", { hasText: "Terminer plus tard" }).first();
    if (await plusTard.count()) { await plusTard.click({ force: true }); await attendre(page, 2000); }
  }
}

// /rejoindre avec un compte existant : « J'ai déjà un compte », identifiants, entrée dans le club.
async function rejoindreAvecCompte(page, token, email, mdp = MDP) {
  await aller(page, `/clubplus/rejoindre?token=${token}`, 6000);
  await bouton(page, "J'ai déjà un compte").click().catch(() => {});
  await attendre(page, 800);
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(mdp);
  await bouton(page, /Se connecter et rejoindre/i).click();
  await attendre(page, 12000);
}

// Un parcours qui casse (bouton absent, délai dépassé) est un échec de CE parcours, pas la fin du
// test : les autres continuent, et le nettoyage a toujours lieu.
async function scenario(nom, fn) {
  try {
    await fn();
  } catch (e) {
    t(`${nom} : le parcours va jusqu'au bout`, false, String(e?.message || e).split("\n")[0].slice(0, 220));
  }
}

const nav = await chromium.launch();
let club = null;

try {
  club = await preparerClub();
  if (!club) {
    console.log(`Club ${CLUB_NOM} introuvable — test ignoré.`);
  } else {
    console.log(`Cible : ${LOCAL ? `app locale ${LOCAL} servie sous ${CP}` : CP} · envois réels autorisés : ${ENVOIS_MAX}`);
    const EQUIPE = club.equipes[0] || null;

    // ═══ A. Un compte existant rejoint le club, pour chaque rôle invitable ═══
    if (doit("A")) {
      console.log("\nA. /rejoindre — chaque rôle invitable, compte existant");
      const ROLES = [
        ["coach", "Coach"], ["resp_equipe", "Responsable d'équipe"], ["directeur_sportif", "Directeur sportif"],
        ["president", "Président"], ["secretaire", "Secrétaire"], ["tresorier", "Trésorier"],
        ["comm", "Responsable communication"], ["membre_bureau", "Membre du bureau"], ["administratif", "Administratif"],
        ["sponsor_mgr", "Responsable sponsors"], ["lecture_seule", "Lecture seule"],
      ];
      for (const [role, libelle] of ROLES) await scenario(`A ${role}`, async () => {
        const email = adresse(`role-${role.replace(/_/g, "")}`);
        await bloquerEnvois(email);
        const userId = await creerCompte(email);
        const teams = ["coach", "resp_equipe"].includes(role) && EQUIPE ? [EQUIPE] : [];
        const inv = await inviter(club, email, role, { teams });
        const { ctx, page, journal } = await ouvrir(nav);
        try {
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`, 6000);
          const accueil = await texte(page);
          t(`[${role}] le lien annonce le club et le rôle « ${libelle} »`, accueil.includes(CLUB_NOM) && accueil.includes(libelle), accueil.slice(0, 160));
          // Adresse saisie en majuscules, avec des espaces : on tape comme on tape sur un téléphone.
          await rejoindreAvecCompte(page, inv.token, `  ${email.toUpperCase()} `);
          const url = page.url();
          await ecarterAssistant(page);
          const bureau = await texte(page);
          t(`[${role}] arrive dans l'espace du club`, /\/clubplus\/dashboard/.test(url) && bureau.includes(CLUB_NOM) && !/Aucun espace disponible/.test(bureau),
            `${url.replace(CP, "")} — ${bureau.slice(0, 160)}`);
          const m = await membre(userId, club.id);
          t(`[${role}] membre actif, bon rôle, bon périmètre`, m?.role === role && m?.status === "actif" && JSON.stringify(m?.teams || []) === JSON.stringify(teams),
            JSON.stringify(m));
          const inv2 = (await lire(`club_invitations?select=statut,accepted_by&id=eq.${inv.id}`))[0];
          t(`[${role}] l'invitation est marquée acceptée par ce compte`, inv2?.statut === "acceptee" && inv2?.accepted_by === userId, JSON.stringify(inv2));
          const { entrees, casses } = await cliquerLeMenu(page);
          console.log(`       menu : ${entrees.join(" | ")}`);
          t(`[${role}] un menu est proposé`, entrees.length >= 3, entrees.join(" | "));
          if (role === "coach") {
            t("[coach] aucune entrée financière dans son menu", !entrees.some((e) => /factur|contrat|devis|abonnement/i.test(e)), entrees.join(" | "));
          }
          if (TOUS_LES_ECRANS) t(`[${role}] chaque écran du menu s'ouvre sans erreur`, casses.length === 0, casses.join(" · "));
          t(`[${role}] aucune erreur JavaScript`, vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
        } finally {
          await ctx.close();
        }
      });
    }

    // ═══ B. Création d'un accès depuis l'invitation ═══
    if (doit("B")) await scenario("B", async () => {
      console.log("\nB. /rejoindre — création d'un nouvel accès");
      const email = adresse("nouveau-coach");
      await bloquerEnvois(email);
      const inv = await inviter(club, email, "coach", { teams: EQUIPE ? [EQUIPE] : [] });
      const { ctx, page, journal } = await ouvrir(nav, { inscriptions: "reel" });
      try {
        await aller(page, `/clubplus/rejoindre?token=${inv.token}`, 6000);
        await bouton(page, "Créer mon accès").click();
        await attendre(page, 800);
        await page.locator("input[type=email]").first().fill(email);
        await page.locator("input[type=password]").first().fill("Zz12345");
        const actifA7 = await bouton(page, /Créer mon espace/i).isEnabled();
        t("le bouton reste inactif sous 8 caractères (la règle réelle du serveur)", !actifA7);
        t("la règle des 8 caractères est annoncée", /8 caract[èe]res/.test(await texte(page)));
        await page.locator("input[type=password]").first().fill(MDP);
        await bouton(page, /Créer mon espace/i).click();
        await attendre(page, 8000);
        const apres = await texte(page);
        const ins = journal.inscriptions.at(-1);
        t("l'inscription part avec une adresse de retour vers Club+, qui ramène sur l'invitation",
          Boolean(ins?.redirect) && ins.redirect.startsWith(`${CP}/clubplus/auth/callback`) && decodeURIComponent(ins.redirect).includes(`/rejoindre?token=${inv.token}`),
          `redirect_to = ${ins?.redirect ?? "(aucune : Supabase renverra sur son URL de site, Connect)"}`);
        t("la suite est expliquée (confirmer l'adresse)", /confirm/i.test(apres) && !ANGLAIS_OU_TECHNIQUE.test(apres), apres.slice(-200));
        const compte = await compteParEmail(email);
        t("le compte existe, pas encore confirmé", Boolean(compte?.id) && !compte?.email_confirmed_at);

        // Le clic sur le lien de l'e-mail.
        if (ins?.reel) {
          const lien = await lienDeConfirmation(email, ins.redirect);
          t("le lien de confirmation est reconstituable", Boolean(lien));
          if (lien) {
            await suivreLienSupabase(page, lien);
            await attendre(page, 9000);
            t("le lien ramène sur l'invitation, connecté", page.url().includes("/clubplus/rejoindre") && /Activer mon espace/.test(await texte(page)),
              `${page.url().replace(CP, "")} — ${(await texte(page)).slice(0, 160)}`);
            await bouton(page, "Activer mon espace").click().catch(() => {});
            await attendre(page, 10000);
          }
        } else {
          // Sans e-mail réel : on confirme par l'API, puis la personne rouvre son lien et se connecte.
          await auth(`admin/users/${compte.id}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });
          await rejoindreAvecCompte(page, inv.token, email);
        }
        await ecarterAssistant(page);
        const bureau = await texte(page);
        t("le nouveau coach entre dans son club", /\/clubplus\/dashboard/.test(page.url()) && bureau.includes(CLUB_NOM), `${page.url().replace(CP, "")} — ${bureau.slice(0, 160)}`);
        const m = compte?.id ? await membre(compte.id, club.id) : null;
        t("rattachement coach, actif, bonne équipe", m?.role === "coach" && m?.status === "actif" && JSON.stringify(m?.teams) === JSON.stringify(EQUIPE ? [EQUIPE] : []), JSON.stringify(m));
        t("aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
      } finally {
        await ctx.close();
      }
    });

    // ═══ C. Cas limites de /rejoindre ═══
    if (doit("C")) {
      console.log("\nC. /rejoindre — cas limites");

      // C1 · Adresse déjà inscrite (un parent de Connect) qui clique « Créer mon accès ».
      await scenario("C1", async () => {
        const email = adresse("deja-inscrit");
        await bloquerEnvois(email);
        const userId = await creerCompte(email);
        const inv = await inviter(club, email, "coach");
        const { ctx, page } = await ouvrir(nav);
        try {
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`);
          await bouton(page, "Créer mon accès").click();
          await page.locator("input[type=email]").first().fill(email);
          await page.locator("input[type=password]").first().fill("AutreMotDePasse!9");
          await bouton(page, /Créer mon espace/i).click();
          await attendre(page, 6000);
          const tx = await texte(page);
          t("adresse déjà inscrite : on le lui dit, au lieu d'attendre un e-mail qui ne partira pas",
            /existe d[ée]j[àa]/i.test(tx) && !/Compte cr[ée]{2}\. Confirmez/i.test(tx), tx.slice(-220));
          await page.locator("input[type=password]").first().fill(MDP);
          await bouton(page, /Se connecter et rejoindre/i).click();
          await attendre(page, 12000);
          t("puis il rejoint le club avec son compte existant", (await membre(userId, club.id))?.status === "actif");
        } finally { await ctx.close(); }
      });

      // C2 · Mauvais mot de passe, puis adresse non confirmée : des messages en français, justes.
      await scenario("C2", async () => {
        const email = adresse("nonconfirme");
        await creerCompte(email, { confirme: false });
        const inv = await inviter(club, email, "coach");
        const { ctx, page } = await ouvrir(nav);
        try {
          await rejoindreAvecCompte(page, inv.token, email, "MauvaisMotDePasse!1");
          const tx1 = await texte(page);
          t("mauvais mot de passe : message en français", /incorrect/i.test(tx1) && !ANGLAIS_OU_TECHNIQUE.test(tx1), tx1.slice(-200));
          await page.locator("input[type=password]").first().fill(MDP);
          await bouton(page, /Se connecter et rejoindre/i).click();
          await attendre(page, 6000);
          const tx2 = await texte(page);
          t("adresse non confirmée : on lui dit de confirmer, pas que son mot de passe est faux",
            /pas encore confirm/i.test(tx2) && !ANGLAIS_OU_TECHNIQUE.test(tx2), tx2.slice(-200));
        } finally { await ctx.close(); }
      });

      // C3 · Connecté avec le mauvais compte : refus clair, et moyen de changer de compte.
      await scenario("C3", async () => {
        const destinataire = adresse("destinataire");
        const intrus = adresse("intrus");
        const intrusId = await creerCompte(intrus);
        const destId = await creerCompte(destinataire);
        const inv = await inviter(club, destinataire, "coach");
        const { ctx, page } = await ouvrir(nav);
        try {
          // L'intrus se connecte d'abord (ordinateur partagé, compte Connect déjà ouvert).
          await aller(page, "/clubplus/auth/login", 4000);
          await page.locator("input[type=email]").first().fill(intrus);
          await page.locator("input[type=password]").first().fill(MDP);
          await bouton(page, "Se connecter").click();
          await attendre(page, 9000);
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`, 6000);
          t("la page dit avec quel compte on est connecté", (await texte(page)).includes(intrus));
          await bouton(page, "Activer mon espace").click();
          await attendre(page, 5000);
          const tx = await texte(page);
          t("un autre compte que le destinataire est refusé, en clair", /autre adresse/i.test(tx) && !(await membre(intrusId, club.id)), tx.slice(-200));
          const changer = bouton(page, /Changer de compte/i);
          t("un bouton permet de changer de compte", (await changer.count()) > 0);
          if (await changer.count()) {
            await changer.click();
            await attendre(page, 3000);
            await page.locator("input[type=email]").first().fill(destinataire);
            await page.locator("input[type=password]").first().fill(MDP);
            await bouton(page, /Se connecter et rejoindre/i).click();
            await attendre(page, 12000);
            t("après changement de compte, le bon destinataire entre", (await membre(destId, club.id))?.status === "actif");
          }
        } finally { await ctx.close(); }
      });

      // C4 · Invitation révoquée, expirée, déjà acceptée, jeton inconnu.
      await scenario("C4", async () => {
        const eRev = adresse("revoquee"), eExp = adresse("expiree");
        const invRev = await inviter(club, eRev, "coach");
        await rpc(club.owner.jeton, "revoquer_invitation_club", { p_id: invRev.id });
        const invExp = await inviter(club, eExp, "coach");
        await api(`club_invitations?id=eq.${invExp.id}`, { method: "PATCH", body: JSON.stringify({ expire_at: new Date(Date.now() - 86400000).toISOString() }) });
        const { ctx, page } = await ouvrir(nav);
        try {
          await aller(page, `/clubplus/rejoindre?token=${invRev.token}`);
          t("invitation révoquée : « annulée par le club »", /annul[ée]e par le club/i.test(await texte(page)));
          await aller(page, `/clubplus/rejoindre?token=${invExp.token}`);
          t("invitation expirée : « a expiré »", /a expir[ée]/i.test(await texte(page)));
          await aller(page, `/clubplus/rejoindre?token=zz-jeton-inconnu-${T0}`);
          t("jeton inconnu : « ce lien n'est pas valide »", /n.est pas valide/i.test(await texte(page)));
          await aller(page, "/clubplus/rejoindre");
          t("lien sans jeton : même message, pas d'écran vide", /n.est pas valide/i.test(await texte(page)));
        } finally { await ctx.close(); }
      });

      // C5 · Double clic sur « Se connecter et rejoindre ».
      await scenario("C5", async () => {
        const email = adresse("doubleclic");
        const userId = await creerCompte(email);
        const inv = await inviter(club, email, "coach");
        const { ctx, page, journal } = await ouvrir(nav);
        try {
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`);
          await page.locator("input[type=email]").first().fill(email);
          await page.locator("input[type=password]").first().fill(MDP);
          await bouton(page, /Se connecter et rejoindre/i).dblclick();
          await attendre(page, 12000);
          const tx = await texte(page);
          t("double clic : un seul rattachement, aucune erreur affichée", (await membre(userId, club.id))?.status === "actif" && !/déjà été utilisée|impossible/i.test(tx), tx.slice(-160));
          t("double clic : aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
        } finally { await ctx.close(); }
      });

      // C6 · Le plafond d'e-mails du projet atteint pendant une création d'accès (429).
      await scenario("C6", async () => {
        const email = adresse("plafond");
        const inv = await inviter(club, email, "coach");
        const { ctx, page } = await ouvrir(nav, { inscriptions: "429" });
        try {
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`);
          await bouton(page, "Créer mon accès").click();
          await page.locator("input[type=email]").first().fill(email);
          await page.locator("input[type=password]").first().fill(MDP);
          await bouton(page, /Créer mon espace/i).click();
          await attendre(page, 4000);
          const tx = await texte(page);
          t("429 (plafond d'e-mails) : message clair en français", /quelques minutes/i.test(tx) && !ANGLAIS_OU_TECHNIQUE.test(tx), tx.slice(-200));
        } finally { await ctx.close(); }
      });

      // C7 · 390 px : la page d'invitation tient dans l'écran d'un téléphone.
      await scenario("C7", async () => {
        const email = adresse("mobile");
        const userId = await creerCompte(email);
        const inv = await inviter(club, email, "coach", { teams: EQUIPE ? [EQUIPE] : [] });
        const { ctx, page, journal } = await ouvrir(nav, { largeur: 390, hauteur: 844 });
        try {
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`);
          t("390 px : l'invitation ne déborde pas", !(await deborde(page)));
          await bouton(page, "Créer mon accès").click();
          await attendre(page, 500);
          t("390 px : le formulaire de création ne déborde pas", !(await deborde(page)));
          await rejoindreAvecCompte(page, inv.token, email);
          await ecarterAssistant(page);
          t("390 px : le coach entre dans son club", (await membre(userId, club.id))?.status === "actif" && (await texte(page)).includes(CLUB_NOM));
          t("390 px : le tableau de bord ne déborde pas", !(await deborde(page)));
          t("390 px : aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
        } finally { await ctx.close(); }
      });

      // C8 · Déjà membre d'un AUTRE espace (mémorisé) : il doit arriver dans le club qu'il rejoint.
      await scenario("C8", async () => {
        const autre = (await (await api("clubs", { method: "POST", body: JSON.stringify({ nom: `ZZ Test Autre Club ${T0}`, plan: "free" }) })).json())[0];
        traces.clubs.add(autre.id);
        const email = adresse("multiclub");
        const userId = await creerCompte(email);
        await api("club_members", { method: "POST", body: JSON.stringify({ user_id: userId, club_id: autre.id, role: "admin", status: "actif" }) });
        const inv = await inviter(club, email, "coach");
        const { ctx, page } = await ouvrir(nav);
        try {
          // Il se connecte d'abord à son club habituel, qui devient l'espace mémorisé.
          await aller(page, "/clubplus/auth/login", 4000);
          await page.locator("input[type=email]").first().fill(email);
          await page.locator("input[type=password]").first().fill(MDP);
          await bouton(page, "Se connecter").click();
          await attendre(page, 9000);
          await ctx.addCookies([{ name: "sv_active_space", value: `organization:${autre.id}`, domain: new URL(CP).hostname, path: "/", secure: true, sameSite: "Lax" }]);
          await aller(page, `/clubplus/rejoindre?token=${inv.token}`, 6000);
          await bouton(page, "Activer mon espace").click();
          await attendre(page, 12000);
          await ecarterAssistant(page);
          const tx = await texte(page);
          t("membre d'un autre espace : il arrive dans le club qu'il vient de rejoindre",
            tx.includes(CLUB_NOM) && !tx.includes(`ZZ Test Autre Club ${T0}`.slice(0, 18)) , tx.slice(0, 200));
        } finally { await ctx.close(); }
      });

      // C9 · Un compte de l'équipe SportVision (OS, opérateur) invité comme coach d'un club.
      await scenario("C9", async () => {
        const email = adresse("staff-os");
        const userId = await creerCompte(email);
        await api("profiles", { method: "POST", body: JSON.stringify({ id: userId, role: "photo", prenom: "ZZ", nom: "Operateur", email }) });
        const inv = await inviter(club, email, "coach", { teams: EQUIPE ? [EQUIPE] : [] });
        const { ctx, page, journal } = await ouvrir(nav);
        try {
          await rejoindreAvecCompte(page, inv.token, email);
          await ecarterAssistant(page);
          const tx = await texte(page);
          const m = await membre(userId, club.id);
          t("compte staff de l'OS : entre comme coach, dans le bon club", m?.role === "coach" && tx.includes(CLUB_NOM), `${JSON.stringify(m)} — ${tx.slice(0, 120)}`);
          t("compte staff de l'OS : aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
        } finally { await ctx.close(); }
      });

      // C10 · Déjà coach d'une équipe, invité sur une seconde : il garde la première (§17).
      if (club.equipes.length >= 2) await scenario("C10", async () => {
        const [e1, e2] = club.equipes;
        const email = adresse("deux-equipes");
        const userId = await creerCompte(email);
        const inv1 = await inviter(club, email, "coach", { teams: [e1] });
        const { ctx, page } = await ouvrir(nav);
        try {
          await rejoindreAvecCompte(page, inv1.token, email);
          const inv2 = await inviter(club, email, "coach", { teams: [e2] });
          await aller(page, `/clubplus/rejoindre?token=${inv2.token}`, 6000);
          await bouton(page, "Activer mon espace").click();
          await attendre(page, 9000);
          const m = await membre(userId, club.id);
          t("seconde équipe : le périmètre s'élargit, rien n'est perdu", JSON.stringify([...(m?.teams || [])].sort()) === JSON.stringify([e1, e2].sort()), JSON.stringify(m));
          // Promu directeur sportif par une nouvelle invitation.
          const inv3 = await inviter(club, email, "directeur_sportif", { teams: [] });
          await aller(page, `/clubplus/rejoindre?token=${inv3.token}`, 6000);
          await bouton(page, "Activer mon espace").click();
          await attendre(page, 8000);
          const m3 = await membre(userId, club.id);
          const tx = await texte(page);
          t("un coach déjà membre, invité comme directeur sportif, prend ce rôle", m3?.role === "directeur_sportif", `${JSON.stringify(m3)} — ${tx.slice(-200)}`);
        } finally { await ctx.close(); }
      });
    }

    // C12 · Le président du club, qui entraîne aussi une équipe, reçoit l'invitation de coach de
    // cette équipe : il garde son rôle de président et gagne l'équipe.
    if (doit("C") && EQUIPE) await scenario("C12", async () => {
      const email = adresse("president-coach");
      const userId = await creerCompte(email);
      const invP = await inviter(club, email, "president");
      await rpc(await jetonMdp(email), "accepter_invitation_club", { p_token: invP.token });
      const invC = await inviter(club, email, "coach", { teams: [EQUIPE] });
      const { ctx, page } = await ouvrir(nav);
      try {
        await rejoindreAvecCompte(page, invC.token, email);
        await aller(page, `/clubplus/rejoindre?token=${invC.token}`, 6000);
        const dejaFait = /d[ée]j[àa] [ée]t[ée] utilis[ée]e/i.test(await texte(page));
        if (!dejaFait) {
          await bouton(page, "Activer mon espace").click().catch(() => {});
          await attendre(page, 8000);
        }
        const m = await membre(userId, club.id);
        t("président invité comme coach : reste président et gagne l'équipe", m?.role === "president" && (m?.teams || []).includes(EQUIPE),
          `${JSON.stringify(m)} — ${(await texte(page)).slice(-200)}`);
      } finally { await ctx.close(); }
    });

    // C11 · Lien de confirmation d'un accès ouvert sur un AUTRE appareil : /auth/callback ne peut
    // pas échanger le code (il n'a pas été émis par ce navigateur) et renvoie sur la connexion en
    // gardant la suite. Après connexion, la personne doit retrouver SON invitation.
    if (doit("C")) await scenario("C11", async () => {
      const email = adresse("autre-appareil");
      const userId = await creerCompte(email);
      const inv = await inviter(club, email, "coach");
      const { ctx, page } = await ouvrir(nav, { largeur: 390, hauteur: 844 });
      try {
        await aller(page, `/clubplus/auth/callback?code=zz-code-inconnu&next=${encodeURIComponent(`/rejoindre?token=${inv.token}`)}`, 5000);
        t("autre appareil : le callback renvoie sur la connexion avec une explication", page.url().includes("/clubplus/auth/login") && /lien de confirmation/i.test(await texte(page)),
          page.url().replace(CP, ""));
        await page.locator("input[type=email]").first().fill(email);
        await page.locator("input[type=password]").first().fill(MDP);
        await bouton(page, "Se connecter").click();
        await attendre(page, 9000);
        t("autre appareil : après connexion, retour sur l'invitation", page.url().includes("/clubplus/rejoindre") && /Activer mon espace/.test(await texte(page)), page.url().replace(CP, ""));
        await bouton(page, "Activer mon espace").click().catch(() => {});
        await attendre(page, 9000);
        t("autre appareil : il rejoint le club", (await membre(userId, club.id))?.status === "actif");
        // Un `next` hostile n'est jamais suivi.
        await ctx.clearCookies();
        await aller(page, `/clubplus/auth/login?next=${encodeURIComponent("//exemple-hostile.invalid/x")}`, 4000);
        await page.locator("input[type=email]").first().fill(email);
        await page.locator("input[type=password]").first().fill(MDP);
        await bouton(page, "Se connecter").click();
        await attendre(page, 8000);
        t("un « next » vers un autre site est ignoré", page.url().startsWith(`${CP}/clubplus/`), page.url());
      } finally { await ctx.close(); }
    });

    // ═══ D. Connexion, lien de confirmation en échec, mot de passe oublié ═══
    if (doit("D")) await scenario("D", async () => {
      console.log("\nD. Connexion et mot de passe");
      const email = adresse("reset");
      await bloquerEnvois(email);
      await creerCompte(email);
      await api("club_members", { method: "POST", body: JSON.stringify({ user_id: (await compteParEmail(email)).id, club_id: club.id, role: "secretaire", status: "actif" }) });
      const { ctx, page, journal } = await ouvrir(nav);
      try {
        await aller(page, "/clubplus/auth/login?confirmation=failed", 4000);
        t("lien de confirmation en échec : la page de connexion l'explique", /lien de confirmation/i.test(await texte(page)));
        await page.locator("input[type=email]").first().fill(email);
        await page.locator("input[type=password]").first().fill("MauvaisMotDePasse!1");
        await bouton(page, "Se connecter").click();
        await attendre(page, 4000);
        const tx = await texte(page);
        t("connexion refusée : message en français", /incorrect/i.test(tx) && !ANGLAIS_OU_TECHNIQUE.test(tx));

        // Mot de passe oublié : le vrai écran, la vraie fonction, l'e-mail bloqué par la liste de suppression.
        await aller(page, "/clubplus/auth/forgot", 4000);
        await page.locator("input[type=email]").first().fill(email);
        await bouton(page, "Envoyer le lien").click();
        await attendre(page, 5000);
        t("mot de passe oublié : réponse neutre en français", /Vérifiez votre boîte mail/i.test(await texte(page)));
        await attendre(page, 3000);
        const file = await lire(`notification_outbox?select=payload_json,status&recipient_email=eq.${encodeURIComponent(email)}&template_key=eq.auth.password_reset&order=created_at.desc&limit=1`);
        let lienReset = file[0]?.payload_json?.reset_url;
        // request-password-reset plafonne à 5 demandes par heure et PAR IP, et répond pareil qu'il
        // ait envoyé ou non (pour ne rien révéler). Plusieurs passages du test dans l'heure épuisent
        // ce plafond : on le signale, et on poursuit avec un lien de même nature émis par l'API.
        if (!lienReset) {
          console.log("       (aucun e-mail mis en file : plafond de request-password-reset probablement atteint pour cette IP — lien émis par l'API)");
          const g = await (await auth("admin/generate_link", {
            method: "POST", body: JSON.stringify({ type: "recovery", email, redirect_to: `${CP}/clubplus/auth/reset` }),
          })).json();
          lienReset = g.action_link;
        } else {
          t("le lien de réinitialisation mis en file ramène sur Club+", decodeURIComponent(lienReset).includes(`${CP}/clubplus/auth/reset`), lienReset.slice(0, 160));
        }
        if (lienReset) {
          await suivreLienSupabase(page, lienReset);
          await attendre(page, 7000);
          t("le lien ouvre l'écran de nouveau mot de passe de Club+", page.url().includes("/clubplus/auth/reset") && /nouveau mot de passe/i.test(await texte(page)), page.url().replace(CP, ""));
          const champs = page.locator("input[type=password]");
          await champs.nth(0).fill("Zz12345");
          await champs.nth(1).fill("Zz12345");
          await bouton(page, "Enregistrer").click();
          await attendre(page, 1500);
          t("7 caractères : refusé avec la règle des 8", /8 caract[èe]res/.test(await texte(page)));
          await champs.nth(0).fill(MDP);
          await champs.nth(1).fill(MDP);
          await bouton(page, "Enregistrer").click();
          await attendre(page, 3000);
          const tx3 = await texte(page);
          t("même mot de passe que l'ancien : dit tel quel, en français", /diff[ée]rent de l.ancien/i.test(tx3) && !ANGLAIS_OU_TECHNIQUE.test(tx3), tx3.slice(-160));
          await champs.nth(0).fill("ZzNouveau!2026-Test");
          await champs.nth(1).fill("ZzNouveau!2026-Test");
          await bouton(page, "Enregistrer").click();
          await attendre(page, 9000);
          t("nouveau mot de passe enregistré, entrée dans le club", (await texte(page)).includes(CLUB_NOM), page.url().replace(CP, ""));
          t("le nouveau mot de passe fonctionne", Boolean(await jetonMdp(email, "ZzNouveau!2026-Test")));
        }
        // Ce parcours PROVOQUE des refus (mauvais mot de passe : 400, même mot de passe : 422) :
        // le navigateur les journalise, ce ne sont pas des erreurs de l'application.
        const erreurs = vraiesErreursCP(journal.erreurs).filter((e) => !/status of (400|422)/.test(e));
        t("aucune erreur JavaScript", erreurs.length === 0, erreurs.slice(0, 3).join(" · "));
      } finally { await ctx.close(); }
    });

    // ═══ E. Club+ Gratuit ═══
    if (doit("E")) await scenario("E", async () => {
      console.log("\nE. /signup-free");
      const nomClub = `ZZ Test Gratuit ${T0}`;
      const email = adresse("gratuit");
      await bloquerEnvois(email);
      const { ctx, page, journal } = await ouvrir(nav, { inscriptions: "reel" });
      try {
        await aller(page, "/clubplus/signup-free", 4000);
        await page.getByLabel("Nom du club").fill(nomClub);
        await page.getByLabel("Prénom").fill("ZZ");
        await page.getByLabel("Nom", { exact: true }).fill("Gratuit");
        await page.getByLabel("Adresse e-mail").fill(email);
        await page.locator("input[type=password]").fill(MDP);
        await bouton(page, /Créer mon espace Club\+ Gratuit/).click();
        await attendre(page, 7000);
        const ins = journal.inscriptions.at(-1);
        t("inscription gratuite : retour prévu sur /clubplus/auth/callback", ins?.redirect === `${CP}/clubplus/auth/callback`, ins?.redirect);
        t("la demande de club voyage avec le compte (autre appareil)", ins?.data?.sv_pending_signup?.clubNom === nomClub, JSON.stringify(ins?.data || {}));
        t("« Vérifiez vos e-mails »", /Vérifiez vos e-mails/i.test(await texte(page)));
        const compte = await compteParEmail(email);

        // Le lien est ouvert sur un AUTRE appareil (nouveau navigateur, aucun localStorage).
        const autre = await ouvrir(nav, { largeur: 390, hauteur: 844 });
        try {
          if (ins?.reel) {
            const lien = await lienDeConfirmation(email, ins.redirect);
            await suivreLienSupabase(autre.page, lien);
            await attendre(autre.page, 8000);
            t("autre appareil : la page de connexion explique la situation", /lien de confirmation/i.test(await texte(autre.page)), autre.page.url().replace(CP, ""));
          } else {
            await auth(`admin/users/${compte.id}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });
            await aller(autre.page, "/clubplus/auth/login", 4000);
          }
          await autre.page.locator("input[type=email]").first().fill(email);
          await autre.page.locator("input[type=password]").first().fill(MDP);
          await bouton(autre.page, "Se connecter").click();
          await attendre(autre.page, 14000);
          await ecarterAssistant(autre.page);
          const tx = await texte(autre.page);
          const clubCree = (await lire(`clubs?select=id,plan&nom=eq.${encodeURIComponent(nomClub)}`))[0];
          if (clubCree) traces.clubs.add(clubCree.id);
          t("autre appareil : le club gratuit est créé et la personne y entre", Boolean(clubCree) && tx.includes(nomClub), tx.slice(0, 200));
          t("formule gratuite, et la personne en est l'administrateur", clubCree?.plan === "free" && (await membre(compte.id, clubCree?.id))?.role === "admin");
          t("autre appareil : aucune erreur JavaScript", vraiesErreursCP(autre.journal.erreurs).length === 0, vraiesErreursCP(autre.journal.erreurs).slice(0, 3).join(" · "));
        } finally { await autre.ctx.close(); }
      } finally { await ctx.close(); }

      // Adresse déjà inscrite (compte Connect sans club).
      await scenario("E2", async () => {
        const email2 = adresse("gratuit-existant");
        await creerCompte(email2);
        const nomClub2 = `ZZ Test Gratuit Existant ${T0}`;
        const { ctx: c2, page: p2, journal: j2 } = await ouvrir(nav);
        try {
          await aller(p2, "/clubplus/signup-free", 4000);
          await p2.getByLabel("Nom du club").fill(nomClub2);
          await p2.getByLabel("Adresse e-mail").fill(email2);
          await p2.locator("input[type=password]").fill("AutreMotDePasse!9");
          // Double clic : une seule inscription doit partir (chacune peut coûter un e-mail).
          await bouton(p2, /Créer mon espace Club\+ Gratuit/).dblclick();
          await attendre(p2, 6000);
          t("double clic sur l'inscription : une seule requête part", j2.inscriptions.length === 1, `${j2.inscriptions.length} requêtes`);
          const tx = await texte(p2);
          t("gratuit, adresse déjà inscrite : on propose de se connecter (pas « vérifiez vos e-mails »)", /existe d[ée]j[àa]/i.test(tx) && !/Vérifiez vos e-mails/i.test(tx), tx.slice(-200));
          if (/existe d[ée]j[àa]/i.test(tx)) {
            await p2.locator("input[type=password]").fill(MDP);
            await bouton(p2, /connecter et créer/i).click();
            await attendre(p2, 14000);
            const clubCree = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(nomClub2)}`))[0];
            if (clubCree) traces.clubs.add(clubCree.id);
            t("puis le club est créé avec ce compte, et il y entre", Boolean(clubCree) && (await texte(p2)).includes(nomClub2));
          }
        } finally { await c2.close(); }
      });
    });

    // ═══ F. Lien d'activation d'un club ═══
    if (doit("F")) {
      console.log("\nF. /activation");
      const nouveauClient = async (email, nom) => {
        const c = (await (await api("clients", { method: "POST", body: JSON.stringify({ nom, email, statut: "prospect", type_client: "club", origine_prospect: "connect" }) })).json())[0];
        traces.clients.add(c.id);
        return c.id;
      };
      const nouveauJeton = async (clientId, nom, extra = {}) => {
        const token = `zz${T0}${Math.random().toString(16).slice(2, 12)}`;
        await api("clubplus_activation_tokens", { method: "POST", body: JSON.stringify({ client_id: clientId, token, club_nom_prefill: nom, plan: "club", ...extra }) });
        return token;
      };

      // F1 · Nouveau compte, lien ouvert sur le même appareil.
      await scenario("F1", async () => {
        const nomClub = `ZZ Test Activation ${T0}`;
        const email = adresse("activation");
        await bloquerEnvois(email);
        const token = await nouveauJeton(await nouveauClient(email, nomClub), nomClub);
        const { ctx, page, journal } = await ouvrir(nav, { inscriptions: "reel" });
        try {
          await aller(page, `/clubplus/activation?token=${token}`, 6000);
          t("le lien annonce le club à activer", (await texte(page)).includes(nomClub));
          await page.getByLabel("Adresse e-mail").fill(email);
          await page.locator("input[type=password]").fill(MDP);
          await bouton(page, /Activer mon espace Club\+/).click();
          await attendre(page, 7000);
          const ins = journal.inscriptions.at(-1);
          t("activation : retour prévu sur /clubplus/auth/callback, activation portée par le compte",
            ins?.redirect === `${CP}/clubplus/auth/callback` && ins?.data?.sv_pending_signup?.token === token, JSON.stringify(ins || {}).slice(0, 200));
          const compte = await compteParEmail(email);
          if (ins?.reel) {
            const lien = await lienDeConfirmation(email, ins.redirect);
            await suivreLienSupabase(page, lien);
            await attendre(page, 14000);
          } else {
            await auth(`admin/users/${compte.id}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });
            await aller(page, "/clubplus/auth/login", 4000);
            await page.locator("input[type=email]").first().fill(email);
            await page.locator("input[type=password]").first().fill(MDP);
            await bouton(page, "Se connecter").click();
            await attendre(page, 14000);
          }
          await ecarterAssistant(page);
          const clubCree = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(nomClub)}`))[0];
          if (clubCree) traces.clubs.add(clubCree.id);
          t("le club est créé, la personne en est l'administrateur et y entre",
            Boolean(clubCree) && (await membre(compte.id, clubCree?.id))?.role === "admin" && (await texte(page)).includes(nomClub), page.url().replace(CP, ""));
          await aller(page, `/clubplus/activation?token=${token}`, 6000);
          const tx = await texte(page);
          t("lien rouvert après usage : « déjà utilisé » et chemin vers la connexion", /d[ée]j[àa] [ée]t[ée] utilis[ée]/i.test(tx) && /connexion/i.test(tx), tx.slice(0, 200));
          t("aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
        } finally { await ctx.close(); }
      });

      // F2 · Compte existant (déjà coach d'un autre club) qui reçoit le lien d'activation d'un club.
      await scenario("F2", async () => {
        const nomClub = `ZZ Test Activation Existant ${T0}`;
        const email = adresse("activation-existant");
        const userId = await creerCompte(email);
        const invCoach = await inviter(club, email, "coach");
        await rpc(await jetonMdp(email), "accepter_invitation_club", { p_token: invCoach.token });
        const token = await nouveauJeton(await nouveauClient(email, nomClub), nomClub);
        const { ctx, page } = await ouvrir(nav);
        try {
          await aller(page, `/clubplus/activation?token=${token}`, 6000);
          await page.getByLabel("Adresse e-mail").fill(email);
          await page.locator("input[type=password]").fill("AutreMotDePasse!9");
          await bouton(page, /Activer mon espace Club\+/).click();
          await attendre(page, 6000);
          const tx = await texte(page);
          t("activation, compte existant : on propose de se connecter (pas « vérifiez vos e-mails »)", /existe d[ée]j[àa]/i.test(tx) && !/Vérifiez vos e-mails/i.test(tx), tx.slice(-200));
          if (/existe d[ée]j[àa]/i.test(tx)) {
            await page.locator("input[type=password]").fill(MDP);
            await bouton(page, /connecter et activer/i).click();
            await attendre(page, 14000);
            await ecarterAssistant(page);
            const clubCree = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(nomClub)}`))[0];
            if (clubCree) traces.clubs.add(clubCree.id);
            t("déjà coach ailleurs : le club du lien est bien créé (pas « déjà activé » avec l'autre club)",
              Boolean(clubCree) && (await membre(userId, clubCree?.id))?.role === "admin", `club créé : ${Boolean(clubCree)}`);
            t("et c'est ce club-là qui s'ouvre", (await texte(page)).includes(nomClub), (await texte(page)).slice(0, 160));
          }
        } finally { await ctx.close(); }
      });

      // F3 · Lien expiré, retiré, inconnu.
      await scenario("F3", async () => {
        const clientId = await nouveauClient(adresse("activation-mort"), `ZZ Test Mort ${T0}`);
        const tExp = await nouveauJeton(clientId, "ZZ", { expires_at: new Date(Date.now() - 86400000).toISOString() });
        const tRev = await nouveauJeton(clientId, "ZZ", { revoked_at: new Date().toISOString() });
        const { ctx, page } = await ouvrir(nav, { largeur: 390, hauteur: 844 });
        try {
          await aller(page, `/clubplus/activation?token=${tExp}`);
          t("activation expirée : message clair", /a expir[ée]/i.test(await texte(page)));
          await aller(page, `/clubplus/activation?token=${tRev}`);
          t("activation retirée : message clair", /retir[ée]/i.test(await texte(page)));
          await aller(page, `/clubplus/activation?token=zz-inconnu-${T0}`);
          t("activation inconnue : message clair", /n.est pas valide/i.test(await texte(page)));
          t("390 px : la page d'activation ne déborde pas", !(await deborde(page)));
        } finally { await ctx.close(); }
      });
    }

    // ═══ G. Lien d'activation des autres structures ═══
    if (doit("G")) await scenario("G", async () => {
      console.log("\nG. /org-activation");
      const nomOrg = `ZZ Test Academie ${T0}`;
      const email = adresse("org-activation");
      const userId = await creerCompte(email);
      const token = `zz${T0}org${Math.random().toString(16).slice(2, 10)}`;
      await api("connect_org_activation_tokens", { method: "POST", body: JSON.stringify({ organization_type: "academie", nom_prefill: nomOrg, token }) });
      const tExp = `zz${T0}orgexp`;
      await api("connect_org_activation_tokens", { method: "POST", body: JSON.stringify({ organization_type: "academie", nom_prefill: nomOrg, token: tExp, expires_at: new Date(Date.now() - 86400000).toISOString() }) });
      const { ctx, page, journal } = await ouvrir(nav);
      try {
        await aller(page, `/clubplus/org-activation?token=${tExp}`);
        t("org-activation expirée : message clair", /a expir[ée]/i.test(await texte(page)));
        await aller(page, `/clubplus/org-activation?token=${token}`);
        t("le lien annonce la structure", (await texte(page)).includes(nomOrg));
        await page.getByLabel("Adresse e-mail").fill(email);
        await page.locator("input[type=password]").fill("AutreMotDePasse!9");
        await bouton(page, /Activer mon espace Club\+/).click();
        await attendre(page, 6000);
        const tx = await texte(page);
        t("org-activation, compte existant : on propose de se connecter", /existe d[ée]j[àa]/i.test(tx) && !/Vérifiez vos e-mails/i.test(tx), tx.slice(-200));
        if (/existe d[ée]j[àa]/i.test(tx)) {
          await page.locator("input[type=password]").fill(MDP);
          await bouton(page, /connecter et activer/i).click();
          await attendre(page, 14000);
          const org = (await lire(`organizations?select=id,organization_type&nom=eq.${encodeURIComponent(nomOrg)}`))[0];
          if (org) traces.orgs.add(org.id);
          const adh = org ? (await lire(`memberships?select=role,status&user_id=eq.${userId}&organization_id=eq.${org.id}`))[0] : null;
          t("l'académie est créée, la personne en est l'administrateur, et y entre",
            org?.organization_type === "academie" && adh?.status === "actif" && (await texte(page)).includes(nomOrg), `${JSON.stringify(adh)} — ${(await texte(page)).slice(0, 120)}`);
        }
        t("aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
      } finally { await ctx.close(); }
    });

    // ═══ I. clubplus-invite (création directe d'un accès, appelée par l'ancien écran) ═══
    // Plus aucun écran de Club+ ne l'appelle, mais la fonction est déployée et répond à quiconque
    // a un jeton : on la teste par l'API, comme le ferait un appel direct.
    if (doit("I")) await scenario("I", async () => {
      console.log("\nI. clubplus-invite");
      const cmEmail = adresse("cm");
      const cmId = await creerCompte(cmEmail);
      await api("profiles", { method: "POST", body: JSON.stringify({ id: cmId, role: "cm", prenom: "ZZ", nom: "CM", email: cmEmail }) });
      await api("club_cm_affectations", { method: "POST", body: JSON.stringify({ club_id: club.id, cm_id: cmId, role: "secondaire", date_debut: new Date().toISOString().slice(0, 10), actif: true }) });
      const jetonCm = await jetonMdp(cmEmail);
      const appeler = async (corps) => {
        const url = FONCTIONS_LOCALES["clubplus-invite"] || `${SB}/functions/v1/clubplus-invite`;
        const r = await fetch(url, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jetonCm}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) });
        return { status: r.status, data: await r.json().catch(() => ({})) };
      };
      const eAdmin = adresse("invite-admin-par-cm");
      const r1 = await appeler({ email: eAdmin, prenom: "ZZ", nom: "Escalade", club_id: club.id, role: "admin", mode: "direct" });
      const cree = await compteParEmail(eAdmin);
      const m1 = cree ? await membre(cree.id, club.id) : null;
      t("un CM ne peut pas créer un compte administrateur du club", r1.status === 403 && !m1, `${r1.status} ${JSON.stringify(r1.data).slice(0, 120)} — rattachement : ${JSON.stringify(m1)}`);

      const eCoach = adresse("invite-direct");
      const r2 = await appeler({ email: `  ${eCoach.toUpperCase()} `, prenom: "ZZ", nom: "Direct", club_id: club.id, role: "coach", teams: EQUIPE ? [EQUIPE] : [], mode: "direct" });
      t("un CM crée l'accès direct d'un coach, mot de passe fourni une fois", r2.status === 200 && typeof r2.data?.password === "string", `${r2.status} ${JSON.stringify(r2.data).slice(0, 120)}`);
      if (r2.data?.password) {
        const { ctx, page, journal } = await ouvrir(nav);
        try {
          await aller(page, "/clubplus/auth/login", 4000);
          await page.locator("input[type=email]").first().fill(eCoach);
          await page.locator("input[type=password]").first().fill(r2.data.password);
          await bouton(page, "Se connecter").click();
          await attendre(page, 10000);
          await ecarterAssistant(page);
          const u = await compteParEmail(eCoach);
          t("le coach créé en direct entre dans son club, avec son équipe",
            (await texte(page)).includes(CLUB_NOM) && (await membre(u?.id, club.id))?.role === "coach", page.url().replace(CP, ""));
          t("aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
        } finally { await ctx.close(); }
      }
      await api(`club_cm_affectations?cm_id=eq.${cmId}`, { method: "DELETE" });
    });

    // ═══ H. Demande d'ouverture → validation SportVision → activation → entrée ═══
    if (doit("H")) await scenario("H", async () => {
      console.log("\nH. /signup/request → validation → activation");
      const nomClub = `ZZ Test Demande ${T0}`;
      const email = adresse("demande");
      const { ctx, page, journal } = await ouvrir(nav, { largeur: 390, hauteur: 844 });
      try {
        await aller(page, "/clubplus/signup/request", 5000);
        await page.locator("button", { hasText: "Équipes, joueurs" }).first().click();
        await bouton(page, "Continuer").click();
        await attendre(page, 2500);
        await page.locator("input[placeholder='FC Fontainebleau']").fill(nomClub);
        const selects = page.locator("select");
        await selects.nth(0).selectOption("Association loi 1901");
        await page.locator("input[placeholder='Fontainebleau']").fill("Villeneuve-la-Guyard");
        await selects.nth(1).selectOption("Football");
        await bouton(page, "Continuer").click();
        await attendre(page, 2500);
        await page.locator("input[placeholder='Sophie']").fill("ZZ");
        await page.locator("input[placeholder='Martin']").fill("Demande");
        await page.locator("input[type=email]").fill(`  ${email.toUpperCase()}  `);
        await page.locator("input[type=tel]").fill("0600000000");
        await page.locator("select").first().selectOption("Président(e)");
        await bouton(page, "Continuer").click();
        await attendre(page, 2500);
        await page.locator("button", { hasText: "Photo / vidéo" }).first().click();
        await bouton(page, "Continuer").click();
        await attendre(page, 2500);
        t("390 px : l'écran de validation ne déborde pas", !(await deborde(page)));
        await page.locator("input[type=checkbox]").first().check();
        await bouton(page, "Envoyer ma demande").click();
        await attendre(page, 7000);
        t("la demande est envoyée", /Demande envoy[ée]e/i.test(await texte(page)), (await texte(page)).slice(0, 160));
        const demande = (await lire(`connect_clubplus_signup_requests?select=id,statut,contact_email&club_nom=eq.${encodeURIComponent(nomClub)}`))[0];
        t("la demande est enregistrée, à traiter par SportVision", demande?.statut === "a_traiter", JSON.stringify(demande));
        t("l'adresse saisie avec espaces et majuscules est la bonne", (demande?.contact_email || "").toLowerCase() === email, demande?.contact_email);

        // Validation par SportVision : un compte staff de test, avec son propre jeton.
        const staffEmail = adresse("staff-sec");
        const staffId = await creerCompte(staffEmail);
        await api("profiles", { method: "POST", body: JSON.stringify({ id: staffId, role: "sec", prenom: "ZZ", nom: "Staff", email: staffEmail }) });
        const r = await fetch(`${SB}/functions/v1/connect-club-signup-review`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${await jetonMdp(staffEmail)}`, "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: demande?.id, action: "valider", plan: "club", initial_role: "admin" }),
        });
        const val = await r.json().catch(() => ({}));
        if (val?.client_id) traces.clients.add(val.client_id);
        t("SportVision valide la demande : un lien d'activation Club+ est émis", r.ok && /\/clubplus\/activation\?token=/.test(val?.activation_url || ""), `${r.status} ${JSON.stringify(val).slice(0, 200)}`);

        if (val?.activation_url) {
          // Le dirigeant a déjà un compte (il a été invité ailleurs, ou il est parent sur Connect).
          const userId = await creerCompte(email);
          await aller(page, val.activation_url.replace(/^https:\/\/[^/]+/, ""), 6000);
          await page.getByLabel("Adresse e-mail").fill(email);
          await page.locator("input[type=password]").fill(MDP);
          const lienExistant = page.locator("button", { hasText: "J'ai déjà un compte SportVision" }).first();
          if (await lienExistant.count()) await lienExistant.click();
          await page.locator("input[type=password]").fill(MDP);
          await bouton(page, /connecter et activer|Activer mon espace Club\+/).click();
          await attendre(page, 14000);
          await ecarterAssistant(page);
          const clubCree = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(nomClub)}`))[0];
          if (clubCree) traces.clubs.add(clubCree.id);
          t("de la demande au club : il existe et le dirigeant y entre", Boolean(clubCree) && (await membre(userId, clubCree?.id))?.status === "actif" && (await texte(page)).includes(nomClub),
            `${page.url().replace(CP, "")} — ${(await texte(page)).slice(0, 160)}`);
        }
        t("aucune erreur JavaScript", vraiesErreursCP(journal.erreurs).length === 0, vraiesErreursCP(journal.erreurs).slice(0, 3).join(" · "));
      } finally { await ctx.close(); }
    });
  }
} finally {
  await nav.close();
  await nettoyer();
}

// ── Nettoyage, vérifié ──────────────────────────────────────────────────────
async function nettoyer() {
  const emails = [...traces.emails];
  const ids = [];
  for (const e of emails) {
    const u = await compteParEmail(e);
    if (u) ids.push(u.id);
  }
  // Clubs et organisations créés par les parcours (activation, gratuit, demande).
  for (const id of ids) {
    for (const m of await lire(`club_members?select=club_id&user_id=eq.${id}`)) {
      if (club && m.club_id !== club.id) traces.clubs.add(m.club_id);
    }
    for (const m of await lire(`memberships?select=organization_id&user_id=eq.${id}`)) {
      if (club && m.organization_id !== club.id) traces.orgs.add(m.organization_id);
    }
  }
  // Garde-fou : on ne supprime JAMAIS un club ou une organisation dont le nom ne commence pas par ZZ.
  const clubsZZ = [];
  for (const id of traces.clubs) {
    const c = (await lire(`clubs?select=id,nom,portail_client_id&id=eq.${id}`))[0];
    if (c && /^ZZ Test/.test(c.nom)) { clubsZZ.push(c); if (c.portail_client_id) traces.clients.add(c.portail_client_id); }
  }
  const orgsZZ = [];
  for (const id of new Set([...traces.orgs, ...clubsZZ.map((c) => c.id)])) {
    const o = (await lire(`organizations?select=id,nom,legacy_client_id&id=eq.${id}`))[0];
    if (o && /^ZZ Test/.test(o.nom)) { orgsZZ.push(o); if (o.legacy_client_id) traces.clients.add(o.legacy_client_id); }
  }
  for (const e of emails) {
    for (const c of await lire(`clients?select=id&email=ilike.${encodeURIComponent(e)}`)) traces.clients.add(c.id);
  }
  const clientsZZ = [];
  for (const id of traces.clients) {
    const c = (await lire(`clients?select=id,email&id=eq.${id}`))[0];
    if (c && /@example\.invalid$/i.test(c.email || "")) clientsZZ.push(c.id);
  }

  const del = (chemin) => api(chemin, { method: "DELETE" });
  for (const id of ids) {
    await del(`club_members?user_id=eq.${id}`);
    await del(`memberships?user_id=eq.${id}`);
    await del(`client_users?id=eq.${id}`);
  }
  for (const c of clubsZZ) {
    await del(`club_members?club_id=eq.${c.id}`);
    await del(`club_onboarding_events?club_id=eq.${c.id}`);
    await del(`clubs?id=eq.${c.id}`);
  }
  for (const o of orgsZZ) {
    await del(`memberships?organization_id=eq.${o.id}`);
    await del(`organizations?id=eq.${o.id}`);
  }
  // Les jetons d'abord : ils pointent vers les demandes (source_request_id) et vers les clients.
  for (const id of clientsZZ) {
    await del(`clubplus_activation_tokens?client_id=eq.${id}`);
    await del(`connect_org_activation_tokens?client_id=eq.${id}`);
  }
  await del(`clubplus_activation_tokens?token=like.zz${T0}*`);
  await del(`connect_org_activation_tokens?token=like.zz${T0}*`);
  for (const e of emails) {
    await del(`club_invitations?email=eq.${encodeURIComponent(e)}`);
    await del(`notification_outbox?recipient_email=eq.${encodeURIComponent(e)}`);
    await del(`communication_suppressions?address=eq.${encodeURIComponent(e)}`);
    await del(`connect_clubplus_signup_requests?contact_email=ilike.${encodeURIComponent(e)}`);
  }
  for (const id of clientsZZ) {
    await del(`client_users?client_id=eq.${id}`);
    // Toute fiche client fait naître une organisation « projet » à son nom (synchronisation
    // clients → organizations) : mesuré au premier passage de ce test, qui en avait laissé quatre.
    for (const o of await lire(`organizations?select=id&legacy_client_id=eq.${id}&nom=like.ZZ*`)) {
      await del(`memberships?organization_id=eq.${o.id}`);
      await del(`organizations?id=eq.${o.id}`);
    }
    await del(`clients?id=eq.${id}`);
  }
  for (const o of await lire(`organizations?select=id&nom=like.ZZ%20Test*${T0}*`)) {
    await del(`memberships?organization_id=eq.${o.id}`);
    await del(`organizations?id=eq.${o.id}`);
  }
  // Les alertes envoyées au staff par les parcours (« nouveau club auto-inscrit », « activé »…).
  await del(`notifications?message=ilike.*ZZ%20Test*${T0}*`);
  // Le journal du club de test : les invitations préparées par ce test portent le prénom « ZZ ».
  if (club) await del(`club_onboarding_events?club_id=eq.${club.id}&detail=ilike.ZZ*`);
  for (const id of ids) {
    await del(`club_cm_affectations?cm_id=eq.${id}`);
    await del(`notifications?destinataire_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  }

  // Vérification : il ne doit rien rester.
  const restes = [];
  for (const e of emails) {
    if (await compteParEmail(e)) restes.push(`compte ${e}`);
    if ((await lire(`club_invitations?select=id&email=eq.${encodeURIComponent(e)}`)).length) restes.push(`invitation ${e}`);
    if ((await lire(`notification_outbox?select=id&recipient_email=eq.${encodeURIComponent(e)}`)).length) restes.push(`e-mail en file ${e}`);
    if ((await lire(`clients?select=id&email=ilike.${encodeURIComponent(e)}`)).length) restes.push(`client ${e}`);
    if ((await lire(`connect_clubplus_signup_requests?select=id&contact_email=ilike.${encodeURIComponent(e)}`)).length) restes.push(`demande ${e}`);
  }
  for (const id of ids) {
    if ((await lire(`club_members?select=id&user_id=eq.${id}`)).length) restes.push(`rattachement ${id}`);
    if ((await lire(`memberships?select=id&user_id=eq.${id}`)).length) restes.push(`adhésion ${id}`);
  }
  if ((await lire(`clubs?select=id&nom=like.*${T0}*`)).length) restes.push("club ZZ");
  if ((await lire(`organizations?select=id&nom=like.*${T0}*`)).length) restes.push("organisation ZZ");
  if ((await lire(`notifications?select=id&message=ilike.*${T0}*`)).length) restes.push("notification staff");
  if (club && (await lire(`club_onboarding_events?select=id&club_id=eq.${club.id}&detail=ilike.ZZ*`)).length) restes.push("journal du club de test");
  t("nettoyage : aucune trace laissée (comptes, rattachements, invitations, clubs, clients, file d'e-mails)", restes.length === 0,
    `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
  console.log(`\nE-mails d'authentification réellement envoyés : ${envoisFaits}`);
}

process.exit(bilan() ? 1 : 0);
