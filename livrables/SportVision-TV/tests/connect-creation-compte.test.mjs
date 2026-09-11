// Connect : toutes les portes d'entrée d'un nouveau compte, cliquées pour de vrai.
//
// POURQUOI CE TEST. Fouka, le 10/09/2026 : « à chaque fois qu'il y a la création d'un compte il y
// a un bug, vérifie bien pour tout ». Les liens d'invitation vont partir par centaines dans les
// groupes WhatsApp des équipes, ouverts sur iPhone, et l'e-mail de confirmation sera très souvent
// ouvert dans une AUTRE application (Gmail, Mail) que celle de l'inscription. C'est ce cas-là qui
// cassait tout (voir auth/callback/route.ts et lib/signup/pending-onboarding.ts), et aucun test ne
// l'empruntait : l'ancien parcours simulait la confirmation par l'API admin, puis se connectait.
// Ici on clique le VRAI lien de l'e-mail, reconstruit à l'identique depuis auth.users.
//
// CE QU'IL COUVRE
//   A. connexion : compte non confirmé (message + renvoi), majuscules, 429, `next` transmis au tunnel,
//      lien de QR d'équipe sans compte ;
//   B. tunnel /signup, chacun des six profils, jusqu'à l'appel signUp() (intercepté : aucun e-mail),
//      en vérifiant ce qui part vers Supabase ; 429 ; adresse déjà inscrite ; double tape ; renvoi ;
//   C. deux inscriptions RÉELLES : un parent invité qui ouvre le lien dans un autre navigateur, et
//      un joueur arrivé par le QR de son équipe qui confirme dans le même navigateur ;
//   D. mot de passe oublié → nouveau mot de passe, y compris comme première session d'un compte ;
//   E. création de compte depuis une commande galerie, adresse déjà inscrite.
//
// QUOTA. Le projet est plafonné à 15 e-mails Supabase par heure, dont de vrais parents ont besoin,
// et chaque e-mail vers une adresse .invalid rebondit sur la réputation d'envoi de sportvision-an.fr.
// Depuis le 10/09/2026 (décision de Fouka), la section C — les deux seules inscriptions RÉELLES,
// donc deux e-mails de confirmation — est SAUTÉE PAR DÉFAUT. `ENVOIS_REELS=1` la réactive, pour
// traverser le vrai échange PKCE du lien de confirmation. `SANS_INSCRIPTION_REELLE=1` reste accepté
// et l'emporte (saute la section C quoi qu'il arrive).
//
// OÙ. Par défaut la production. `CX=http://localhost:3311` teste un build local (voir README) contre
// la vraie base : Supabase n'accepte de rediriger que vers le domaine de production, le test
// réécrit donc la redirection de production vers le serveur local — exactement ce que fera la
// version déployée.
//
// PROPRETÉ. Club de test de Fouka (Villeneuve 340 SC), adresses zz-connect-…@example.invalid, tout
// est supprimé à la fin et la suppression est vérifiée.
//
//   node livrables/SportVision-TV/tests/connect-creation-compte.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, ANON, env, enTeteAdmin, jeton } from "./_session-os.mjs";

const PROD = "https://connect.sportvision-an.fr";
const CX = (process.env.CX || PROD).replace(/\/+$/, "");
const LOCAL = CX !== PROD;
const REELLES = process.env.ENVOIS_REELS === "1" && !process.env.SANS_INSCRIPTION_REELLE;
const CLUB = "Villeneuve 340 SC";
const MDP = "ZzConnect!2026-Test";
const T0 = Date.now();
const IPHONE_WHATSAPP = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24.14";
const { t, bilan } = rapporteur();

const REF = SB.replace(/^https:\/\/([^.]+)\..*$/, "$1");
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });
const authApi = (c, o = {}) => fetch(`${SB}/auth/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });
const lire = async (c) => (await api(c)).json();
// auth.users n'est pas exposé par PostgREST : lecture seule par l'API Management.
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return r.json();
}
const texte = async (p) => ((await p.evaluate(() => document.body.innerText)) || "").replace(/\s+/g, " ");
const debordement = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const adresse = (objet) => `zz-connect-${objet}-${T0}@example.invalid`;

const aNettoyer = { comptes: new Set(), emails: new Set(), enfants: [], codes: [], commandes: [] };

async function creerCompte(objet, { confirme = true, meta = {} } = {}) {
  const email = adresse(objet);
  aNettoyer.emails.add(email);
  const r = await authApi("admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: MDP, email_confirm: confirme, user_metadata: { first_name: "ZZ", last_name: "ZZConnect", ...meta } }),
  });
  const u = await r.json();
  if (u.id) aNettoyer.comptes.add(u.id);
  return { id: u.id, email };
}

// Un navigateur « neuf » : ni cookie, ni stockage — c'est ce que voit l'application Gmail qui
// ouvre le lien. En local, la redirection que Supabase fait vers la production est renvoyée au
// serveur local.
async function contexte(navigateur, { largeur = 390, hauteur = 844, ua } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, ...(ua ? { userAgent: ua } : {}) });
  if (LOCAL) {
    // Playwright n'intercepte pas la cible d'une redirection : on rejoue donc la vérification de
    // Supabase nous-mêmes, et on réécrit sa redirection de production vers le serveur local.
    await ctx.route(`${SB}/auth/v1/verify**`, async (rt) => {
      const rep = await rt.fetch({ maxRedirects: 0 });
      const loc = rep.headers()["location"] || "";
      if (loc.startsWith(PROD)) return rt.fulfill({ status: 302, headers: { location: loc.replace(PROD, CX) } });
      return rt.fulfill({ response: rep });
    });
  }
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 180)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|status of 40[134]|Download the React DevTools|Failed to load resource/i.test(m.text())) erreurs.push(m.text().slice(0, 180));
  });
  return { ctx, page, erreurs };
}

// Réponse de Supabase à un signUp réussi, sans session (confirmation par e-mail active) — pour
// parcourir le tunnel sans envoyer d'e-mail.
function fauxSignUp(email) {
  const id = crypto.randomUUID();
  const maintenant = new Date().toISOString();
  return {
    id, aud: "authenticated", role: "", email, phone: "", confirmation_sent_at: maintenant,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
    identities: [{ identity_id: crypto.randomUUID(), id, user_id: id, identity_data: { email, sub: id }, provider: "email", created_at: maintenant, updated_at: maintenant }],
    created_at: maintenant, updated_at: maintenant, is_anonymous: false,
  };
}

// Les quatre étapes de /signup. `reponse` : null = vrai appel Supabase, sinon (route) => void.
async function tunnel(page, { depart = "/signup", email, profil, etape3, etape4, reponse }) {
  const envoi = { corps: null, redirectTo: null, nb: 0 };
  await page.route("**/auth/v1/signup**", async (rt) => {
    envoi.nb++;
    envoi.corps = JSON.parse(rt.request().postData() || "{}");
    envoi.redirectTo = new URL(rt.request().url()).searchParams.get("redirect_to");
    if (reponse) await reponse(rt);
    else await rt.continue();
  });
  if (depart) await page.goto(`${CX}${depart}`, { waitUntil: "networkidle" });
  const champs = page.locator("input:not([type=hidden])");
  await champs.nth(0).fill("ZZ");
  await champs.nth(1).fill("ZZConnect");
  await champs.nth(2).fill(email);
  await champs.nth(3).fill(MDP);
  await champs.nth(4).fill(MDP);
  await page.locator("button", { hasText: "Continuer" }).click();
  await page.waitForURL(/\/signup\/profil/, { timeout: 15000 });
  // Libellé EXACT : « Autre » se lit aussi dans « un autre sport » (carte Sportif), qui vient avant.
  await page.getByText(profil.libelle, { exact: true }).click();
  if (profil.precision) await page.locator("#su-other").fill(profil.precision);
  await page.locator("button", { hasText: "Continuer" }).click();
  await page.waitForURL(/\/signup\/sport/, { timeout: 15000 });
  if (etape3) await etape3(page);
  await page.locator("button", { hasText: "Continuer" }).click();
  await page.waitForURL(/\/signup\/club/, { timeout: 15000 });
  await etape4(page);
  await page.waitForTimeout(4500);
  await page.unroute("**/auth/v1/signup**");
  return envoi;
}
const creerSansClub = async (p) => { await p.locator("button", { hasText: "Créer mon compte" }).click(); };
const sportFootball = async (p) => {
  await p.locator("button", { hasText: /^Football$/ }).click();
  await p.locator("input[type=date]").fill("2009-05-05");
};

// Le lien exact de l'e-mail de confirmation : {{ .ConfirmationURL }} = /verify?token=<jeton>&type=
// signup&redirect_to=<emailRedirectTo>. Le jeton est celui que Supabase vient de ranger dans
// auth.users ; la redirection est celle que l'application a demandée, sur le domaine de
// production (seul autorisé par Supabase).
async function lienDeConfirmation(email, redirectTo) {
  const ligne = (await sql(`select confirmation_token from auth.users where email = '${email.replace(/'/g, "")}'`))?.[0];
  if (!ligne?.confirmation_token) return null;
  const cible = (redirectTo || `${PROD}/auth/callback`).replace(CX, PROD);
  return `${SB}/auth/v1/verify?token=${ligne.confirmation_token}&type=signup&redirect_to=${encodeURIComponent(cible)}`;
}
async function seConnecter(page, email, { depart = "/auth/login", mdp = MDP } = {}) {
  if (depart) await page.goto(`${CX}${depart}`, { waitUntil: "networkidle" });
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(mdp);
  await page.locator("button", { hasText: /Se connecter/ }).click();
  await page.waitForTimeout(8000);
}
const idDe = async (email) => (await sql(`select id from auth.users where email = '${email.replace(/'/g, "")}'`))?.[0]?.id ?? null;

const club = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB)}`))[0];
const equipe = (await lire(`club_teams?select=id,name&club_id=eq.${club.id}&order=name&limit=1`))[0];
const invitant = (await lire(`club_members?select=user_id&club_id=eq.${club.id}&role=eq.admin&status=eq.actif&limit=1`))[0];

console.log(`\nConnect — création de compte · ${CX}${LOCAL ? " (build local, base réelle)" : ""}`);
const navigateur = await chromium.launch();

try {
  // Le QR de l'équipe : un code créé pour le test, supprimé à la fin.
  const code = `ZZCX${String(T0).slice(-6)}`;
  const insCode = await api("team_invite_codes", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ club_id: club.id, team_id: equipe.id, code, actif: true }) });
  const ligneCode = (await insCode.json())?.[0];
  if (ligneCode?.id) aNettoyer.codes.push(ligneCode.id);
  t("décor : un code d'équipe du club de test", !!ligneCode?.id, `HTTP ${insCode.status}`);

  // ════════════════════════════════════════════════════════════════════════
  //  A. Connexion
  // ════════════════════════════════════════════════════════════════════════
  console.log("\nA. Connexion");
  {
    const nc = await creerCompte("nonconfirme", { confirme: false });
    const { ctx, page, erreurs } = await contexte(navigateur);
    let renvoi = null;
    await page.route("**/auth/v1/resend**", async (rt) => {
      renvoi = { corps: JSON.parse(rt.request().postData() || "{}"), redirectTo: new URL(rt.request().url()).searchParams.get("redirect_to") };
      await rt.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await seConnecter(page, nc.email, { depart: "/auth/login?next=%2Fmes-invitations" });
    const ecran = await texte(page);
    t("compte non confirmé : on le lui dit (pas « mot de passe incorrect »)", /pas encore confirmée/i.test(ecran) && !/mot de passe incorrect/i.test(ecran), ecran.slice(0, 200));
    const bouton = page.locator("button", { hasText: /Renvoyer l'e-mail de confirmation/ });
    t("et on lui propose un nouveau lien", (await bouton.count()) === 1);
    if (await bouton.count()) {
      await bouton.click();
      await page.waitForTimeout(2500);
      t("le renvoi vise la bonne adresse, et ramène sur /auth/callback avec la page d'origine",
        renvoi?.corps?.email === nc.email && /\/auth\/callback\?next=%2Fmes-invitations/.test(renvoi?.redirectTo || ""), JSON.stringify(renvoi));
      t("et confirme l'envoi à l'écran", /Nouveau lien envoyé/.test(await texte(page)));
    }
    t("pas de débordement horizontal en 390 px", !(await debordement(page)));

    await page.route("**/auth/v1/token**", (rt) => rt.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: "over_request_rate_limit", message: "Request rate limit reached" }) }));
    await seConnecter(page, nc.email);
    t("429 à la connexion : message clair en français", /Trop de tentatives/.test(await texte(page)), (await texte(page)).slice(0, 160));
    await page.unroute("**/auth/v1/token**");

    await page.goto(`${CX}/auth/login?next=%2Fmes-invitations`, { waitUntil: "networkidle" });
    // Décision du 10/09/2026 : la case n'avait aucun effet (session de 400 jours dans tous les cas),
    // elle est retirée plutôt que de promettre ce qu'elle ne tenait pas.
    t("plus de case « Rester connecté » qui ne faisait rien",
      !(await texte(page)).includes("Rester connecté") && (await page.locator("input[type=checkbox]").count()) === 0);
    const href = await page.locator("a", { hasText: "Créer mon compte" }).getAttribute("href");
    t("« Créer mon compte » garde la page d'origine (next)", href === "/signup?next=%2Fmes-invitations", href);
    t("aucune erreur JavaScript", erreurs.length === 0, erreurs.slice(0, 3).join(" | "));
    await ctx.close();
  }
  {
    const c = await creerCompte("majuscules");
    const { ctx, page } = await contexte(navigateur, { largeur: 1440, hauteur: 900 });
    await seConnecter(page, `  ${c.email.toUpperCase()}  `);
    t("adresse en majuscules et entourée d'espaces : connexion acceptée", /\/dashboard/.test(page.url()), page.url().replace(CX, ""));
    t("l'accueil salue par le prénom saisi, pas par l'adresse", /Bonjour ZZ\b/.test(await texte(page)), (await texte(page)).match(/Bonjour [^ ]+/)?.[0]);
    // Ce que fait réellement la session, sans case à cocher : un cookie persistant.
    const cookie = (await ctx.cookies()).find((k) => /^sb-.*-auth-token/.test(k.name));
    t("la session est conservée (cookie persistant, plus de 300 jours)", !!cookie && cookie.expires > Date.now() / 1000 + 300 * 86400,
      cookie ? `expire le ${new Date(cookie.expires * 1000).toISOString().slice(0, 10)}` : "aucun cookie de session");
    await ctx.close();
  }
  {
    // Formulaire « code d'équipe » (10/09/2026, décision de Fouka) : la date de naissance déjà
    // connue — ici sur la fiche joueur — est préremplie au lieu d'être redemandée à vide.
    const c = await creerCompte("datenaissance");
    await api("player_profiles", { method: "POST", body: JSON.stringify({ user_id: c.id, prenom: "ZZ", nom: "ZZConnectDate", date_naissance: "2010-04-17", account_status: "actif" }) });
    const sansDate = await creerCompte("sansdate");
    for (const [compte, attendu, libelle] of [[c, "2010-04-17", "la date de la fiche joueur est préremplie"], [sansDate, "", "sans date connue, le champ reste vide (rien n'est deviné)"]]) {
      const { ctx, page } = await contexte(navigateur);
      await seConnecter(page, compte.email);
      await page.goto(`${CX}/affiliations/ajouter?code=${code}`, { waitUntil: "networkidle" });
      const champ = page.locator("#ac-code-birth");
      const valeur = (await champ.count()) ? await champ.inputValue() : "(champ absent)";
      t(`formulaire « code d'équipe » : ${libelle}`, valeur === attendu, `valeur : « ${valeur} » — ${page.url().replace(CX, "")}`);
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await contexte(navigateur);
    await page.goto(`${CX}/join/${code}`, { waitUntil: "networkidle" });
    t("QR d'équipe sans compte : la page montre le club", (await texte(page)).includes(CLUB));
    const creer = await page.locator("a", { hasText: /Créer mon espace/ }).getAttribute("href");
    const continuer = await page.locator("a", { hasText: /^Continuer$/ }).getAttribute("href");
    t("« Créer mon espace » ramènera sur ce QR après confirmation", creer === `/signup?next=${encodeURIComponent(`/join/${code}`)}`, creer);
    t("« Continuer » passe par la connexion puis revient sur ce QR (joueur OU parent)", continuer === `/auth/login?next=${encodeURIComponent(`/join/${code}`)}`, continuer);
    await ctx.close();

    // Un parent déjà inscrit (compte particulier), pas encore connecté, qui scanne le QR.
    const parent = await creerCompte("parentqr");
    await api("connect_profile_settings", { method: "POST", body: JSON.stringify({ user_id: parent.id, account_type: "particulier", profil_particulier: "parent" }) });
    const q = await contexte(navigateur);
    await q.page.goto(`${CX}/join/${code}`, { waitUntil: "networkidle" });
    await q.page.locator("a", { hasText: /^Continuer$/ }).click();
    await q.page.waitForURL(/\/auth\/login/, { timeout: 15000 });
    await seConnecter(q.page, parent.email, { depart: null });
    const suite = q.page.locator("a", { hasText: /^Continuer$/ });
    if (await suite.count()) { await suite.click(); await q.page.waitForTimeout(6000); }
    t("un parent qui scanne le QR sans être connecté arrive, après connexion, sur « Qui rejoint ? » avec le code",
      q.page.url().includes(`/particulier/rejoindre/${code}`), q.page.url().replace(CX, ""));
    await q.ctx.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  B. Le tunnel /signup, profil par profil (signUp intercepté : aucun e-mail)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\nB. Tunnel /signup, les six profils");
  const reussi = (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fauxSignUp(rt.request().postDataJSON().email)) });
  const PROFILS = [
    { nom: "joueur, club partenaire trouvé", libelle: "Joueur / Joueuse", etape3: sportFootball,
      etape4: async (p) => {
        await p.locator("button", { hasText: "Je cherche mon club" }).click();
        await p.locator("input[placeholder^='Rechercher']").fill("Villeneuve 340");
        await p.locator("button", { hasText: CLUB }).first().click({ timeout: 15000 });
        await p.locator("button", { hasText: /^Rejoindre/ }).click();
      },
      attendu: { action: "join", accountType: "joueur", orgId: club.id, sport: "Football", dateNaissance: "2009-05-05" } },
    { nom: "joueur, plus tard", libelle: "Joueur / Joueuse", etape3: sportFootball,
      etape4: async (p) => { await p.locator("button", { hasText: /Non \/ plus tard/ }).click(); await p.locator("button", { hasText: "Créer mon compte" }).click(); },
      attendu: { action: "skip", accountType: "joueur", prenom: "ZZ", nom: "ZZConnect", dateNaissance: "2009-05-05" } },
    { nom: "sportif, club déclaré", libelle: "Sportif / Sportive",
      etape3: async (p) => { await p.locator("button", { hasText: /^Autre$/ }).first().click(); await p.locator("#su-sport-other").fill("Escalade"); await p.locator("input[type=date]").fill("1998-02-02"); },
      etape4: async (p) => {
        await p.locator("button", { hasText: /mon club n'est pas sur SportVision/ }).click();
        await p.locator("#dc-name").fill("ZZ Club déclaré"); await p.locator("#dc-city").fill("Nemours");
        await p.locator("button", { hasText: "Ajouter à mon profil" }).click();
      },
      attendu: { action: "declare", accountType: "joueur", sport: "Escalade", name: "ZZ Club déclaré", city: "Nemours" } },
    { nom: "particulier", libelle: "Particulier",
      etape3: async (p) => { await p.locator("button", { hasText: "Réserver une prestation" }).click(); },
      etape4: creerSansClub, attendu: { action: "skip", accountType: "particulier" }, sansProfilParticulier: true },
    { nom: "parent", libelle: "Parent / Responsable légal", etape4: creerSansClub, attendu: { action: "skip", accountType: "particulier", profilParticulier: "parent" } },
    { nom: "agent", libelle: "Agent / représentant", etape4: creerSansClub, attendu: { action: "skip", accountType: "particulier", profilParticulier: "agent" } },
    { nom: "autre (tuteur)", libelle: "Autre", precision: "Tuteur de mon neveu", etape4: creerSansClub, attendu: { action: "skip", accountType: "particulier", profilParticulier: "tuteur" } },
  ];
  for (const [i, profil] of PROFILS.entries()) {
    const email = adresse(`tunnel${i}`);
    const large = i === 0;
    const { ctx, page, erreurs } = await contexte(navigateur, large ? { largeur: 1440, hauteur: 900 } : {});
    const envoi = await tunnel(page, { depart: "/signup?next=%2Fmes-invitations", email, profil, etape3: profil.etape3, etape4: profil.etape4, reponse: reussi });
    const intention = envoi.corps?.data?.sv_inscription || {};
    const ecarts = Object.entries(profil.attendu).filter(([k, v]) => intention[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(intention[k])} au lieu de ${JSON.stringify(v)}`);
    if (profil.sansProfilParticulier && intention.profilParticulier) ecarts.push(`profilParticulier inattendu : ${intention.profilParticulier}`);
    t(`${profil.nom}${large ? " (1440 px)" : ""} : signUp part avec la bonne intention, attachée au compte`, envoi.nb === 1 && ecarts.length === 0 && intention.email === email,
      `${envoi.nb} appel(s) ; ${ecarts.join(" ; ") || JSON.stringify(intention)}`);
    t(`${profil.nom} : le lien de confirmation ramènera sur la page d'origine`, /\/auth\/callback\?next=%2Fmes-invitations$/.test(envoi.redirectTo || ""), envoi.redirectTo);
    t(`${profil.nom} : écran « Vérifiez votre boîte mail » avec l'adresse`, /\/signup\/verify/.test(page.url()) && (await texte(page)).includes(email), page.url().replace(CX, ""));
    t(`${profil.nom} : sans débordement ni erreur JavaScript`, !(await debordement(page)) && erreurs.length === 0, erreurs.slice(0, 2).join(" | "));

    if (i === 4) {
      // Renvoi depuis « Vérifiez votre boîte mail » : Supabase refuse (60 s entre deux e-mails).
      let renvoi = null;
      await page.route("**/auth/v1/resend**", async (rt) => {
        renvoi = new URL(rt.request().url()).searchParams.get("redirect_to");
        await rt.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "For security purposes, you can only request this after 42 seconds." }) });
      });
      await page.locator("button", { hasText: "Renvoyer l'e-mail" }).click();
      await page.waitForTimeout(2000);
      const ecran = await texte(page);
      t("renvoi refusé : on le dit (et plus « E-mail renvoyé »)", /Patientez 4[0-2] secondes/.test(ecran) && !/^E-mail renvoyé/.test(ecran), ecran.slice(0, 260));
      t("le renvoi ramène lui aussi sur /auth/callback avec la page d'origine", /\/auth\/callback\?next=%2Fmes-invitations$/.test(renvoi || ""), renvoi);
    }
    await ctx.close();
  }

  // 429 : le plafond de 15 e-mails par heure est atteint.
  {
    const { ctx, page } = await contexte(navigateur);
    const envoi = await tunnel(page, { email: adresse("quota"), profil: PROFILS[4], etape4: creerSansClub,
      reponse: (rt) => rt.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }) }) });
    const ecran = await texte(page);
    t("plafond d'e-mails atteint : message clair, la personne sait qu'il faut attendre", envoi.nb === 1 && /Trop d'e-mails de confirmation/.test(ecran) && /une heure/.test(ecran), ecran.slice(0, 260));
    t("et reste sur l'écran, rien de perdu", /\/signup\/club/.test(page.url()));
    await ctx.close();
  }
  // Double tape sur « Créer mon compte » : un seul signUp.
  {
    const { ctx, page } = await contexte(navigateur);
    const envoi = await tunnel(page, { email: adresse("doubletape"), profil: PROFILS[4],
      etape4: async (p) => { await p.locator("button", { hasText: "Créer mon compte" }).dblclick(); },
      reponse: async (rt) => { await new Promise((r) => setTimeout(r, 1500)); await reussi(rt); } });
    t("double tape : un seul appel à Supabase", envoi.nb === 1, `${envoi.nb} appels`);
    await ctx.close();
  }
  // Inscription reprise sur une adresse jamais confirmée. Mesuré le 10/09/2026 par l'API : Supabase
  // renvoie l'e-mail mais garde le mot de passe de la première inscription. L'écran doit le dire.
  {
    const { ctx, page } = await contexte(navigateur);
    await tunnel(page, { email: adresse("reprise"), profil: PROFILS[4], etape4: creerSansClub,
      reponse: (rt) => {
        const u = fauxSignUp(rt.request().postDataJSON().email);
        u.created_at = new Date(Date.now() - 3 * 86400000).toISOString();
        return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(u) });
      } });
    const ecran = await texte(page);
    t("inscription reprise : prévenu que le PREMIER mot de passe reste valable, avec la porte « nouveau mot de passe »",
      /déjà été commencée/.test(ecran) && (await page.locator("a", { hasText: "Choisir un nouveau mot de passe" }).count()) === 1, ecran.slice(0, 260));
    await ctx.close();
  }
  // Fermeture en cours de tunnel puis reprise : on revient à l'étape 1 (le mot de passe n'est
  // jamais stocké), le reste est prérempli, le profil déjà choisi est conservé.
  {
    const { ctx, page } = await contexte(navigateur);
    const email = adresse("fermeture");
    await page.goto(`${CX}/signup`, { waitUntil: "networkidle" });
    const champs = page.locator("input:not([type=hidden])");
    await champs.nth(0).fill("ZZ"); await champs.nth(1).fill("ZZConnect"); await champs.nth(2).fill(email);
    await champs.nth(3).fill(MDP); await champs.nth(4).fill(MDP);
    await page.locator("button", { hasText: "Continuer" }).click();
    await page.waitForURL(/\/signup\/profil/);
    await page.getByText("Parent / Responsable légal", { exact: true }).click();
    await page.locator("button", { hasText: "Continuer" }).click();
    await page.waitForURL(/\/signup\/sport/);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const repris = /\/signup(\?|$)/.test(page.url()) && (await champs.nth(2).inputValue()) === email && (await champs.nth(0).inputValue()) === "ZZ" && (await champs.nth(3).inputValue()) === "";
    t("tunnel rechargé : retour à l'étape 1, nom et adresse préremplis, mot de passe à ressaisir", repris, page.url().replace(CX, ""));
    if (repris) {
      await champs.nth(3).fill(MDP); await champs.nth(4).fill(MDP);
      await page.locator("button", { hasText: "Continuer" }).click();
      await page.waitForURL(/\/signup\/profil/);
      await page.locator("button", { hasText: "Continuer" }).click();
      t("et le profil choisi avant la fermeture est conservé", await page.waitForURL(/\/signup\/sport/, { timeout: 5000 }).then(() => true).catch(() => false));
    }
    await ctx.close();
  }
  // Adresse déjà inscrite et confirmée : vrai appel (Supabase n'envoie aucun e-mail dans ce cas).
  {
    const deja = await creerCompte("dejainscrit");
    const { ctx, page } = await contexte(navigateur);
    const envoi = await tunnel(page, { email: deja.email, profil: PROFILS[4], etape4: creerSansClub, reponse: null });
    const ecran = await texte(page);
    t("adresse déjà inscrite : message clair", envoi.nb === 1 && /Un compte SportVision utilise déjà cette adresse/.test(ecran), ecran.slice(0, 200));
    t("et deux portes de sortie (se connecter, mot de passe oublié)",
      (await page.locator("a", { hasText: "Me connecter" }).count()) === 1 && (await page.locator("a", { hasText: "Mot de passe oublié" }).count()) === 1);
    await ctx.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  C0. Deux navigateurs, un seul rejeu (sans e-mail)
  // ════════════════════════════════════════════════════════════════════════
  // Le compte porte l'intention dans ses métadonnées, comme après un vrai signUp ; le navigateur
  // de l'inscription en garde une copie locale. Le premier qui se connecte la rejoue ; l'autre ne
  // doit PAS la rejouer une seconde fois (pour un joueur : deux demandes d'adhésion au club).
  console.log("\nC0. Deux navigateurs, un seul rejeu");
  {
    const intention = { action: "skip", accountType: "particulier", profilParticulier: "agent" };
    const c = await creerCompte("deuxnav", { meta: { sv_inscription: { ...intention, email: adresse("deuxnav") } } });
    const B = await contexte(navigateur, { largeur: 1440, hauteur: 900 });
    await seConnecter(B.page, c.email);
    const cps = (await lire(`connect_profile_settings?select=account_type,profil_particulier&user_id=eq.${c.id}`))[0];
    t("navigateur de l'e-mail : l'intention portée par le compte est rejouée", cps?.account_type === "particulier" && cps?.profil_particulier === "agent", JSON.stringify(cps));
    t("et il arrive dans l'Espace particulier", /\/particulier/.test(B.page.url()), B.page.url().replace(CX, ""));
    const meta = (await sql(`select raw_user_meta_data->>'sv_inscription_rejouee' as rejouee, raw_user_meta_data ? 'sv_inscription' as reste from auth.users where id='${c.id}'`))?.[0];
    t("le compte la marque rejouée", meta?.rejouee === "true" && meta?.reste === false, JSON.stringify(meta));
    await B.ctx.close();

    const A = await contexte(navigateur, { ua: IPHONE_WHATSAPP });
    await A.ctx.addInitScript(({ cle, valeur }) => { try { localStorage.setItem(cle, valeur); } catch { /* */ } },
      { cle: "sv_connect_pending_signup", valeur: JSON.stringify({ action: "skip", accountType: "joueur", email: c.email }) });
    let rejeux = 0;
    A.page.on("request", (rq) => { if (rq.url().includes("/functions/v1/connect-player-onboarding")) rejeux++; });
    await seConnecter(A.page, c.email);
    const cps2 = (await lire(`connect_profile_settings?select=account_type&user_id=eq.${c.id}`))[0];
    t("navigateur de l'inscription, plus tard : aucun second rejeu", rejeux === 0 && cps2?.account_type === "particulier", `${rejeux} appel(s), ${JSON.stringify(cps2)}`);
    await A.ctx.close();

    // Téléphone prêté : l'inscription inachevée d'un parent ne doit pas s'appliquer à l'enfant qui
    // se connecte ensuite sur le même appareil.
    const enfant = await creerCompte("appareilprete");
    const P = await contexte(navigateur);
    await P.ctx.addInitScript(({ cle, valeur }) => { try { localStorage.setItem(cle, valeur); } catch { /* */ } },
      { cle: "sv_connect_pending_signup", valeur: JSON.stringify({ action: "skip", accountType: "particulier", profilParticulier: "parent", email: adresse("parentinacheve") }) });
    await seConnecter(P.page, enfant.email);
    const cps3 = (await lire(`connect_profile_settings?select=account_type&user_id=eq.${enfant.id}`))[0];
    t("appareil partagé : l'inscription d'une autre adresse ne bascule pas ce compte", !cps3 && /\/dashboard/.test(P.page.url()), `${JSON.stringify(cps3)} ${P.page.url().replace(CX, "")}`);
    await P.ctx.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  C. Deux inscriptions réelles, lien de l'e-mail cliqué
  // ════════════════════════════════════════════════════════════════════════
  if (!REELLES) console.log("\nC. (sautée : aucune inscription réelle sans ENVOIS_REELS=1)");
  else {
    console.log("\nC1. Parent invité — inscription dans WhatsApp, e-mail ouvert dans un autre navigateur");
    const jInv = await jeton((await (await authApi(`admin/users/${invitant.user_id}`)).json()).email);
    const enfant = (await (await api("player_profiles", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ club_id: club.id, prenom: "ZZ", nom: `ZZConnectEnfant${T0 % 100000}`, date_naissance: "2015-03-12" }) })).json())?.[0];
    if (enfant?.id) aNettoyer.enfants.push(enfant.id);
    const email = adresse("parent");
    aNettoyer.emails.add(email);
    const inv = await fetch(`${SB}/functions/v1/clubplus-family-invite`, {
      method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jInv.acces}`, "Content-Type": "application/json" },
      body: JSON.stringify({ club_id: club.id, target_type: "parent", email, prenom: "ZZ", nom: "ZZConnect", player_id: enfant?.id }),
    });
    t("le club invite le parent (vraie fonction serveur)", inv.status < 300, `HTTP ${inv.status}`);

    const A = await contexte(navigateur, { ua: IPHONE_WHATSAPP });
    await A.page.goto(`${CX}/mes-invitations`, { waitUntil: "networkidle" });
    await A.page.locator("a", { hasText: "Créer mon compte" }).click();
    await A.page.waitForURL(/\/signup/, { timeout: 15000 });
    t("depuis l'invitation, « Créer mon compte » ouvre le tunnel en gardant /mes-invitations", /\/signup\?next=%2Fmes-invitations/.test(A.page.url()), A.page.url().replace(CX, ""));
    const envoi = await tunnel(A.page, { depart: null, email, profil: PROFILS[4], etape4: creerSansClub, reponse: null });
    t("inscription réelle : écran « Vérifiez votre boîte mail »", /\/signup\/verify/.test(A.page.url()), (await texte(A.page)).slice(0, 160));
    const id = await idDe(email);
    if (id) aNettoyer.comptes.add(id);
    const lien = await lienDeConfirmation(email, envoi.redirectTo);
    t("le compte existe, non confirmé, avec un lien de confirmation", !!id && !!lien);

    const B = await contexte(navigateur, { largeur: 1440, hauteur: 900 });
    if (lien) {
      await B.page.goto(lien, { waitUntil: "networkidle" });
      await B.page.waitForTimeout(3000);
      const ecran = await texte(B.page);
      const confirme = (await sql(`select email_confirmed_at from auth.users where email='${email}'`))?.[0]?.email_confirmed_at;
      t("autre navigateur : l'adresse est confirmée en base", !!confirme);
      t("et la page le DIT (au lieu de « lien plus valide… recommencez votre inscription »)",
        /confirmation=ok/.test(B.page.url()) && /Votre adresse e-mail est confirmée/.test(ecran) && !/recommencez votre inscription/.test(ecran), `${B.page.url().replace(CX, "")} — ${ecran.slice(0, 120)}`);
      t("en gardant la page d'origine", /next=%2Fmes-invitations/.test(B.page.url()), B.page.url().replace(CX, ""));
      await seConnecter(B.page, email, { depart: null });
      t("après connexion dans ce navigateur, il arrive sur ses invitations", /\/mes-invitations/.test(B.page.url()), B.page.url().replace(CX, ""));
      const cps = id ? (await lire(`connect_profile_settings?select=account_type,profil_particulier&user_id=eq.${id}`))[0] : null;
      t("son choix « Parent » a suivi (compte particulier, profil parent)", cps?.account_type === "particulier" && cps?.profil_particulier === "parent", JSON.stringify(cps));
      const accepter = B.page.locator("button", { hasText: /Créer mon espace parent/ });
      t("il voit l'invitation du club", (await texte(B.page)).includes(CLUB) && (await accepter.count()) === 1);
      if (await accepter.count()) {
        await accepter.click();
        await B.page.waitForTimeout(8000);
        t("et l'accepte : rattaché à son enfant", /Vous [êe]tes rattach[ée]/.test(await texte(B.page)), (await texte(B.page)).slice(0, 160));
      }
      const pp = id ? (await lire(`parent_profiles?select=id&user_id=eq.${id}`))[0] : null;
      const liens = pp ? await lire(`parent_player_relationships?select=player_id,statut&parent_id=eq.${pp.id}`) : [];
      t("en base : lien parent-enfant confirmé, avec cet enfant seulement", liens.length === 1 && liens[0].player_id === enfant?.id && liens[0].statut === "confirme", JSON.stringify(liens));
      const meta = (await sql(`select raw_user_meta_data->>'sv_inscription_rejouee' as rejouee from auth.users where id='${id}'`))?.[0];
      t("l'intention est marquée rejouée sur le compte", meta?.rejouee === "true", JSON.stringify(meta));
      t("aucune erreur JavaScript (navigateur de l'e-mail)", B.erreurs.length === 0, B.erreurs.slice(0, 3).join(" | "));

      // Plus tard, il revient dans le navigateur de WhatsApp, qui a gardé sa copie locale.
      let rejeux = 0;
      A.page.on("request", (rq) => { if (rq.url().includes("/functions/v1/connect-player-onboarding")) rejeux++; });
      await seConnecter(A.page, email);
      t("de retour dans WhatsApp : pas de second rejeu de l'inscription", rejeux === 0, `${rejeux} appel(s)`);
      t("et il arrive dans l'Espace particulier", /\/particulier/.test(A.page.url()), A.page.url().replace(CX, ""));
      t("aucune erreur JavaScript (navigateur de l'inscription)", A.erreurs.length === 0, A.erreurs.slice(0, 3).join(" | "));
    }
    await A.ctx.close();
    await B.ctx.close();

    console.log("\nC2. Joueur arrivé par le QR de son équipe — même navigateur");
    {
      const email = adresse("joueurqr");
      aNettoyer.emails.add(email);
      const A = await contexte(navigateur, { ua: IPHONE_WHATSAPP });
      await A.page.goto(`${CX}/join/${code}`, { waitUntil: "networkidle" });
      await A.page.locator("a", { hasText: /Créer mon espace/ }).click();
      await A.page.waitForURL(/\/signup/, { timeout: 15000 });
      const envoi = await tunnel(A.page, { depart: null, email, profil: PROFILS[1], etape3: sportFootball, etape4: PROFILS[1].etape4, reponse: null });
      t("inscription réelle depuis le QR : écran « Vérifiez votre boîte mail »", /\/signup\/verify/.test(A.page.url()), (await texte(A.page)).slice(0, 160));
      const id = await idDe(email);
      if (id) aNettoyer.comptes.add(id);
      const lien = await lienDeConfirmation(email, envoi.redirectTo);
      if (lien) {
        await A.page.goto(lien, { waitUntil: "networkidle" });
        await A.page.waitForTimeout(6000);
        t("même navigateur : le lien connecte et ramène sur le QR de l'équipe", A.page.url().endsWith(`/join/${code}`), A.page.url().replace(CX, ""));
        const cps = id ? (await lire(`connect_profile_settings?select=account_type,sport&user_id=eq.${id}`))[0] : null;
        t("compte joueur, sport rejoué", cps?.account_type === "joueur" && cps?.sport === "Football", JSON.stringify(cps));
        await A.page.locator("a", { hasText: /^Continuer$/ }).click();
        await A.page.waitForURL(/\/affiliations\/ajouter/, { timeout: 15000 });
        t("« Continuer » ouvre le formulaire, code prérempli", (await A.page.locator("#ac-code-code").inputValue()) === code);
        await A.page.locator("#ac-code-birth").fill("2009-05-05");
        await A.page.locator("button", { hasText: "Rejoindre avec ce code" }).click();
        await A.page.waitForTimeout(8000);
        const joueurs = id ? await lire(`player_profiles?select=id,club_id&user_id=eq.${id}`) : [];
        const demandes = joueurs.length ? await lire(`membership_requests?select=source,team_id,statut&player_id=in.(${joueurs.map((j) => j.id).join(",")})`) : [];
        t("en base : demande d'adhésion par code, à la bonne équipe", demandes.length === 1 && demandes[0].source === "code_equipe" && demandes[0].team_id === equipe.id, JSON.stringify(demandes));
        await A.page.goto(`${CX}/dashboard`, { waitUntil: "networkidle" });
        t("l'accueil salue par le prénom", /Bonjour ZZ\b/.test(await texte(A.page)), (await texte(A.page)).match(/Bonjour [^ ]+/)?.[0]);
        t("aucune erreur JavaScript", A.erreurs.length === 0, A.erreurs.slice(0, 3).join(" | "));

        // Second clic sur le même lien, depuis un autre navigateur.
        const B = await contexte(navigateur);
        await B.page.goto(lien, { waitUntil: "networkidle" });
        await B.page.waitForTimeout(3000);
        const ecran = await texte(B.page);
        t("lien déjà utilisé : message juste (déjà servi ou expiré → se connecter)", /déjà servi ou a expiré/.test(ecran) && !/recommencez votre inscription/.test(ecran), ecran.slice(0, 200));
        await B.ctx.close();
      }
      await A.ctx.close();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  D. Mot de passe oublié
  // ════════════════════════════════════════════════════════════════════════
  console.log("\nD. Mot de passe oublié");
  {
    const { ctx, page } = await contexte(navigateur);
    await page.goto(`${CX}/auth/forgot`, { waitUntil: "networkidle" });
    await page.locator("input[type=email]").fill(adresse("inconnu"));
    await page.locator("button", { hasText: "Envoyer le lien" }).click();
    await page.waitForTimeout(5000);
    const ecran = await texte(page);
    t("adresse inconnue : même réponse qu'une adresse connue (rien à deviner)", /Si un compte existe/.test(ecran), ecran.slice(0, 160));
    t("durée annoncée cohérente avec l'e-mail (24 heures)", /valable 24 heures/.test(ecran), ecran.slice(0, 220));
    await ctx.close();

    // Première session d'un compte jamais confirmé, par « mot de passe oublié » : le choix fait à
    // l'inscription doit être rejoué (sinon : Espace joueur par défaut).
    const c = await creerCompte("reset", { confirme: false, meta: { sv_inscription: { action: "skip", accountType: "particulier", profilParticulier: "parent" } } });
    const lien = (await (await authApi("admin/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email: c.email, redirect_to: `${PROD}/auth/reset` }) })).json()).action_link;
    const r = await contexte(navigateur);
    await r.page.goto(lien, { waitUntil: "networkidle" });
    await r.page.waitForTimeout(4000);
    const champs = r.page.locator("input[type=password]");
    t("le lien ouvre « Nouveau mot de passe »", (await champs.count()) === 2, (await texte(r.page)).slice(0, 160));
    if ((await champs.count()) === 2) {
      await champs.nth(0).fill("ZzNouveau!2026");
      await champs.nth(1).fill("ZzNouveau!2026");
      await r.page.locator("button", { hasText: /Enregistrer/ }).click();
      await r.page.waitForTimeout(9000);
      t("puis mène dans le bon espace (particulier)", /\/particulier/.test(r.page.url()), r.page.url().replace(CX, ""));
      const cps = (await lire(`connect_profile_settings?select=account_type,profil_particulier&user_id=eq.${c.id}`))[0];
      t("le choix de l'inscription a été rejoué", cps?.account_type === "particulier" && cps?.profil_particulier === "parent", JSON.stringify(cps));
      const s = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: c.email, password: "ZzNouveau!2026" }) });
      t("le nouveau mot de passe permet de se connecter", s.status === 200, `HTTP ${s.status}`);
    }
    t("aucune erreur JavaScript", r.erreurs.length === 0, r.erreurs.slice(0, 3).join(" | "));
    await r.ctx.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  E. Création de compte depuis une commande galerie
  // ════════════════════════════════════════════════════════════════════════
  console.log("\nE. Commande galerie");
  {
    const acheteur = await creerCompte("galerie");
    const commande = (await (await api("media_orders", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ club_id: club.id, amount_cents: 0, status: "paid", guest_email: acheteur.email }) })).json())?.[0];
    if (commande?.id) aNettoyer.commandes.push(commande.id);
    const droit = commande?.id ? (await (await api("media_download_grants", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ order_id: commande.id, email: acheteur.email }) })).json())?.[0] : null;
    t("décor : une commande payée avec son lien", !!droit?.token);
    if (droit?.token) {
      const { ctx, page } = await contexte(navigateur);
      await page.goto(`${CX}/gallery/commande/${droit.token}`, { waitUntil: "networkidle" });
      await page.locator("#cx-mdp").fill(MDP);
      await page.locator("button", { hasText: /Créer mon compte gratuitement/ }).click();
      await page.waitForTimeout(5000);
      const ecran = await texte(page);
      t("adresse déjà inscrite : on l'envoie se connecter (au lieu d'attendre un e-mail qui ne partira pas)",
        /déjà un compte avec cette adresse/.test(ecran) && !/Vérifiez votre adresse e-mail/.test(ecran), ecran.slice(-260));
      await ctx.close();
    }
  }
} finally {
  await navigateur.close();

  // ── Nettoyage, dans l'ordre des dépendances, vérifié ──────────────────────
  for (const email of aNettoyer.emails) {
    const id = await idDe(email);
    if (id) aNettoyer.comptes.add(id);
  }
  for (const id of aNettoyer.comptes) {
    const pp = (await lire(`parent_profiles?select=id&user_id=eq.${id}`))[0];
    if (pp) {
      await api(`parent_player_relationships?parent_id=eq.${pp.id}`, { method: "DELETE" });
      await api(`parent_profiles?id=eq.${pp.id}`, { method: "DELETE" });
    }
    for (const p of await lire(`player_profiles?select=id&user_id=eq.${id}`)) {
      await api(`team_memberships?player_id=eq.${p.id}`, { method: "DELETE" });
      await api(`membership_requests?player_id=eq.${p.id}`, { method: "DELETE" });
      await api(`player_profiles?id=eq.${p.id}`, { method: "DELETE" });
    }
    await api(`connect_profile_settings?user_id=eq.${id}`, { method: "DELETE" });
    await authApi(`admin/users/${id}`, { method: "DELETE" });
  }
  for (const id of aNettoyer.enfants) {
    await api(`parent_player_relationships?player_id=eq.${id}`, { method: "DELETE" });
    await api(`player_profiles?id=eq.${id}`, { method: "DELETE" });
  }
  for (const email of aNettoyer.emails) {
    await api(`player_invitations?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
    await api(`parent_invitations?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  }
  for (const id of aNettoyer.commandes) {
    await api(`media_download_grants?order_id=eq.${id}`, { method: "DELETE" });
    await api(`media_orders?id=eq.${id}`, { method: "DELETE" });
  }
  for (const id of aNettoyer.codes) await api(`team_invite_codes?id=eq.${id}`, { method: "DELETE" });

  const reste = (await sql(`select
      (select count(*) from auth.users where email like 'zz-connect-%@example.invalid') comptes,
      (select count(*) from player_profiles where nom like 'ZZConnect%') fiches,
      (select count(*) from parent_invitations where email like 'zz-connect-%') inv_parent,
      (select count(*) from player_invitations where email like 'zz-connect-%') inv_joueur,
      (select count(*) from team_invite_codes where code like 'ZZCX%') codes,
      (select count(*) from media_download_grants where email like 'zz-connect-%') droits,
      (select count(*) from media_orders where guest_email like 'zz-connect-%') commandes,
      (select count(*) from connect_profile_settings s where not exists (select 1 from auth.users u where u.id = s.user_id)) reglages_orphelins`))?.[0] || {};
  const total = Object.values(reste).reduce((a, v) => a + Number(v || 0), 0);
  t("rien ne subsiste (comptes, fiches, invitations, codes, commandes, réglages)", total === 0, JSON.stringify(reste) + " — À NETTOYER À LA MAIN");
}

process.exit(bilan() ? 1 : 0);
