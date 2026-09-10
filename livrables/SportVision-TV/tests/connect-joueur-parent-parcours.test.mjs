// Connect : un vrai joueur et un vrai parent, du lien du club jusqu'a leur espace.
//
// POURQUOI CE TEST. Le GO multi-clubs du 10/09/2026 portait une reserve : les invitations joueur et
// parent etaient prouvees EN BASE, jamais cliquees dans Connect. Fouka : « Le backend est prouve,
// mais ce sont les deux parcours qui n'ont pas encore ete cliques reellement. » Ce sont pourtant
// ceux qui partiront par centaines dans les groupes WhatsApp des equipes.
//
// LE PARCOURS REEL, tel qu'il est depuis le 10/09 : le club n'invente plus de compte. Il envoie une
// invitation, la personne cree ELLE-MEME son compte dans Connect, arrive sur /mes-invitations, voit
// ce qui lui est adresse — l'adresse tient lieu de jeton — et accepte.
//
// CE QUE LE TEST FAIT. Il emprunte chaque etape pour de vrai, en 390 px parce que c'est sur un
// telephone que le lien sera ouvert :
//   1. le club invite, par la vraie fonction serveur, avec le jeton du dirigeant ;
//   2. la personne ouvre /mes-invitations, est renvoyee vers la connexion, choisit « Creer mon
//      compte » et remplit les quatre etapes ;
//   3. on simule le clic dans l'e-mail de confirmation, qu'une adresse .invalid ne peut pas recevoir ;
//   4. elle se connecte, retombe sur /mes-invitations, voit son club, accepte ;
//   5. on mesure en base ce qui en resulte, et ce que la personne peut lire.
//
// PROPRETE. Club de test de Fouka (Villeneuve 340 SC), adresses en .invalid, tout supprime a la fin
// — et la suppression est verifiee.
//
// AUCUN E-MAIL REEL PAR DEFAUT (decision de Fouka, 10/09/2026). L'etape 2 appelait le vrai signUp()
// de Supabase : un e-mail de confirmation par parcours, vers une adresse .invalid qui rebondit, sur
// le quota de 15 e-mails par heure partage avec les vrais parents. Desormais l'appel signUp() de
// l'ecran est intercepte : on verifie ce qu'il envoie (adresse, prenom, adresse de retour), puis le
// compte est cree par l'API d'administration, qui n'envoie rien, avec exactement les donnees de
// l'ecran — l'etape 3 le confirme ensuite comme avant. `ENVOIS_REELS=1` retablit le vrai signUp().
// L'invitation du club (clubplus-family-invite) n'ecrit plus aux adresses .invalid une fois la
// fonction redeployee (meme regle que dispatch-notifications).

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, ANON, enTeteAdmin, jeton } from "./_session-os.mjs";

const CX = "https://connect.sportvision-an.fr";
const ENVOIS_REELS = process.env.ENVOIS_REELS === "1";
const CLUB = "Villeneuve 340 SC";
const MDP = "ZzConnect!2026-Test";
const { t, bilan } = rapporteur();

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const authApi = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const texte = async (page) => ((await page.evaluate(() => document.body.innerText)) || "").replace(/\s+/g, " ");

const club = (await (await api(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB)}`)).json())[0];
const equipe = (await (await api(`club_teams?select=id,name&club_id=eq.${club.id}&limit=1`)).json())[0];
const invitant = (await (await api(`club_members?select=user_id&club_id=eq.${club.id}&role=eq.admin&status=eq.actif&limit=1`)).json())[0];
const emailInvitant = (await (await authApi(`admin/users/${invitant.user_id}`)).json()).email;
const jetonInvitant = await jeton(emailInvitant);

// Ce que le club envoie, par sa vraie fonction serveur — pas une insertion en base.
// FAMILLE_LOCALE=http://localhost:8000/ : l'invitation passe par la copie du depot de
// clubplus-family-invite, lancee en local contre la vraie base (utile tant que la version deployee
// ecrit encore aux adresses .invalid).
async function inviter(corps) {
  const r = await fetch(process.env.FAMILLE_LOCALE || `${SB}/functions/v1/clubplus-family-invite`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jetonInvitant.acces}`, "Content-Type": "application/json" },
    body: JSON.stringify({ club_id: club.id, prenom: "ZZ", ...corps }),
  });
  return { status: r.status, corps: await r.text() };
}

// Intercepte le signUp() de l'ecran (voir en-tete). La reponse imite celle de Supabase pour une
// inscription qui attend la confirmation de l'adresse : un utilisateur, aucune session.
async function intercepterInscription(page, journal) {
  if (ENVOIS_REELS) return;
  await page.route(`${SB}/auth/v1/signup**`, async (route) => {
    let corps = {};
    try { corps = JSON.parse(route.request().postData() || "{}"); } catch { corps = {}; }
    journal.push({ email: corps.email, data: corps.data || {}, redirect: new URL(route.request().url()).searchParams.get("redirect_to") });
    const u = await (await authApi("admin/users", {
      method: "POST",
      body: JSON.stringify({ email: corps.email, password: corps.password, email_confirm: false, user_metadata: corps.data || {} }),
    })).json();
    const maintenant = new Date().toISOString();
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        id: u.id, aud: "authenticated", role: "authenticated", email: String(corps.email || "").toLowerCase(), phone: "",
        confirmation_sent_at: maintenant, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: corps.data || {},
        identities: [{ identity_id: u.id, id: u.id, user_id: u.id, provider: "email", identity_data: { email: corps.email, sub: u.id }, created_at: maintenant, updated_at: maintenant }],
        created_at: maintenant, updated_at: maintenant, is_anonymous: false,
      }),
    });
  });
}

// Les quatre etapes de /signup, cliquees.
async function inscrire(page, email, profil, etape3) {
  const journal = [];
  await intercepterInscription(page, journal);
  await page.goto(`${CX}/mes-invitations`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  t(`${profil} : /mes-invitations renvoie vers la connexion en gardant la destination`,
    /auth\/login\?next=%2Fmes-invitations/.test(page.url()), page.url().replace(CX, ""));

  await page.locator("a, button", { hasText: "Créer mon compte" }).first().click();
  await page.waitForTimeout(5000);
  const champs = page.locator("input:not([type=hidden])");
  await champs.nth(0).fill("ZZ");
  await champs.nth(1).fill(profil);
  await champs.nth(2).fill(email);
  await champs.nth(3).fill(MDP);
  await champs.nth(4).fill(MDP);
  await page.locator("button", { hasText: "Continuer" }).first().click();
  await page.waitForTimeout(4000);

  await page.locator("button").filter({ hasText: profil === "Joueur" ? "Joueur / Joueuse" : "Parent" }).first().click();
  await page.waitForTimeout(1200);
  await page.locator("button", { hasText: /Continuer/ }).first().click().catch(() => {});
  await page.waitForTimeout(4000);

  await etape3(page);

  // Derniere etape : on laisse l'affiliation a l'invitation, qui l'apporte deja.
  const plusTard = page.locator("button").filter({ hasText: /Non \/ plus tard|plus tard/i }).first();
  if (await plusTard.count()) { await plusTard.click(); await page.waitForTimeout(1500); }
  // Le bouton final s'intitule « Creer mon compte » sur les deux parcours. La premiere version
  // cherchait « Creer mon espace » ou « Terminer » : elle s'arretait a l'etape 4 sans rien
  // soumettre, et concluait que le compte n'avait pas ete cree. Il ne l'avait pas ete, en effet —
  // par la faute du test, pas de l'application.
  for (const libelle of [/Cr[ée]er mon compte/i, /Cr[ée]er mon espace/i, /Terminer/i, /Continuer/i]) {
    const b = page.locator("button", { hasText: libelle }).first();
    if (await b.count() && await b.isEnabled().catch(() => false)) { await b.click(); await page.waitForTimeout(6000); break; }
  }
  if (!ENVOIS_REELS) {
    // Ce que l'ecran a demande a Supabase : exactement ce que le vrai signUp() aurait recu.
    const envoi = journal[0];
    t(`${profil} : l'ecran demande la creation du compte (interceptee, aucun e-mail)`,
      journal.length === 1 && envoi.email === email.toLowerCase() && envoi.data?.first_name === "ZZ" && /\/auth\/callback/.test(envoi.redirect || ""),
      JSON.stringify(journal).slice(0, 220));
    await page.unroute(`${SB}/auth/v1/signup**`);
  }
  return await texte(page);
}

async function confirmerEtConnecter(page, email) {
  const compte = (await (await authApi(`admin/users?filter=${encodeURIComponent(email)}`)).json())?.users?.[0];
  if (compte?.id) {
    // Le clic dans l'e-mail de confirmation, qu'une adresse .invalid ne recevra jamais.
    await authApi(`admin/users/${compte.id}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });
  }
  await page.goto(`${CX}/auth/login?next=%2Fmes-invitations`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(MDP);
  await page.locator("button", { hasText: /Se connecter/ }).first().click();
  await page.waitForTimeout(9000);
  return compte?.id ?? null;
}

const navigateur = await chromium.launch();
const aNettoyer = { comptes: [], emails: [], enfants: [] };

try {
  // ══════════════════════════════════════════════════════════════════════
  //  JOUEUR
  // ══════════════════════════════════════════════════════════════════════
  {
    const email = `zz-joueur-connect-${Date.now()}@example.invalid`;
    aNettoyer.emails.push(email);
    console.log(`\nJoueur invite sur ${CLUB} / ${equipe.name}`);

    const inv = await inviter({ target_type: "joueur", email, nom: "Joueur", team_id: equipe.id, date_naissance: "2009-05-05" });
    t("le club invite un joueur par sa fonction serveur", inv.status < 300, `HTTP ${inv.status} — ${inv.corps.slice(0, 140)}`);

    const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 180)));

    const fin = await inscrire(page, email, "Joueur", async (p) => {
      await p.locator("button", { hasText: /^Football$/ }).first().click().catch(() => {});
      await p.locator("input[type=date]").first().fill("2009-05-05").catch(() => {});
      await p.locator("button", { hasText: /Continuer/ }).first().click().catch(() => {});
      await p.waitForTimeout(4000);
    });
    const id = await confirmerEtConnecter(page, email);
    if (id) aNettoyer.comptes.push(id);
    t("le joueur a cree son compte par le formulaire", !!id, `fin du formulaire : « ${fin.slice(0, 140)} »`);

    t("apres connexion, il retombe sur /mes-invitations", /mes-invitations/.test(page.url()), page.url().replace(CX, ""));
    const invitations = await texte(page);
    t("il y voit l'invitation de son club", invitations.includes(CLUB), invitations.slice(0, 220));

    const accepter = page.locator("button", { hasText: /Rejoindre mon [ée]quipe|Cr[ée]er mon espace parent|Accepter/i }).first();
    t("un bouton lui permet d'accepter", await accepter.count() > 0);
    if (await accepter.count()) {
      await accepter.click();
      await page.waitForTimeout(9000);
      const apres = await texte(page);
      t("l'acceptation aboutit sans erreur affichee", !/erreur|impossible|introuvable/i.test(apres), apres.slice(0, 200));
      console.log(`       arrivee : ${page.url().replace(CX, "")}`);      // Le joueur, lui, attend bien une validation du club : le message doit le dire.
      t("le joueur lit que le club doit encore valider son adhesion", /doit encore valider/i.test(apres), apres.slice(0, 200));
    }

    // En base : l'invitation est consommee.
    const pi = (await (await api(`player_invitations?select=statut&email=eq.${encodeURIComponent(email)}`)).json())[0];
    t("l'invitation joueur est marquee acceptee en base", /accept/i.test(pi?.statut || ""), JSON.stringify(pi || {}));

    // Et ce qu'il peut lire : son club, rien de l'interne SportVision.
    if (id) {
      const j = await jeton(email);
      const lire = (c) => fetch(`${SB}/rest/v1/${c}`, { headers: { apikey: ANON, Authorization: `Bearer ${j.acces}` } }).then((r) => r.json());
      const clients = await lire("clients?select=id");
      const staff = await lire("profiles?select=id,telephone");
      t("le joueur ne lit aucun client SportVision", Array.isArray(clients) ? clients.length === 0 : true, `${clients?.length} ligne(s)`);
      t("ni l'annuaire interne, ni le moindre telephone de collaborateur",
        Array.isArray(staff) ? staff.filter((s) => s.id !== id).length === 0 : true,
        `${Array.isArray(staff) ? staff.filter((s) => s.id !== id).length : "?"} profil(s) d'autrui`);
    }

    t("aucune erreur JavaScript sur le parcours joueur", erreurs.length === 0, erreurs.slice(0, 3).join("\n       "));
    await ctx.close();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PARENT
  // ══════════════════════════════════════════════════════════════════════
  {
    // Un enfant inscrit au club, que le CLUB designe dans l'invitation. C'est le decor : dans la
    // vraie vie il vient de l'effectif ou d'un import. Pose en service_role, comme le ferait l'app.
    const nomEnfant = `ZZEnfant${Date.now() % 100000}`;
    const r = await api("player_profiles", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ club_id: club.id, prenom: "ZZ", nom: nomEnfant, date_naissance: "2015-03-12" }),
    });
    const enfant = (await r.json())?.[0];
    if (enfant?.id) aNettoyer.enfants.push(enfant.id);
    t("le decor : un enfant inscrit au club", !!enfant?.id, `HTTP ${r.status}`);

    const email = `zz-parent-connect-${Date.now()}@example.invalid`;
    aNettoyer.emails.push(email);
    console.log(`\nParent invite pour l'enfant ${nomEnfant}`);

    const inv = await inviter({ target_type: "parent", email, nom: "Parent", player_id: enfant?.id });
    t("le club invite un parent par sa fonction serveur", inv.status < 300, `HTTP ${inv.status} — ${inv.corps.slice(0, 140)}`);

    const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 180)));

    const fin = await inscrire(page, email, "Parent", async (p) => {
      await p.locator("button", { hasText: /Continuer/ }).first().click().catch(() => {});
      await p.waitForTimeout(4000);
    });
    const id = await confirmerEtConnecter(page, email);
    if (id) aNettoyer.comptes.push(id);
    t("le parent a cree son compte par le formulaire", !!id, `fin du formulaire : « ${fin.slice(0, 140)} »`);

    t("apres connexion, il retombe sur /mes-invitations", /mes-invitations/.test(page.url()), page.url().replace(CX, ""));
    const invitations = await texte(page);
    t("il y voit l'invitation du club", invitations.includes(CLUB), invitations.slice(0, 220));

    // Le libelle est « Creer mon espace parent » pour un parent, « Rejoindre mon equipe » pour un
    // joueur (mes-invitations/page.tsx). La premiere version cherchait « Accepter » ou
    // « Rejoindre » : elle trouvait le bouton joueur et declarait le parcours parent sans issue.
    const accepter = page.locator("button", { hasText: /Rejoindre mon [ée]quipe|Cr[ée]er mon espace parent|Accepter/i }).first();
    t("un bouton lui permet d'accepter", await accepter.count() > 0);
    if (await accepter.count()) {
      await accepter.click();
      await page.waitForTimeout(9000);
      const apres = await texte(page);
      t("l'acceptation aboutit sans erreur affichee", !/erreur|impossible|introuvable/i.test(apres), apres.slice(0, 200));
      console.log(`       arrivee : ${page.url().replace(CX, "")}`);      // Jusqu'au 10/09/2026, le parent lisait « Le club doit encore valider votre adhesion » alors que
      // son rattachement est confirme des l'acceptation (statut « confirme » verifie ci-dessous).
      t("le parent lit qu'il est rattache a son enfant", /Vous [êe]tes rattach[ée] [àa]/i.test(apres), apres.slice(0, 200));
      t("sans message d'attente de validation", !/doit encore valider/i.test(apres), apres.slice(0, 200));
    }

    // En base : rattache a CET enfant, confirme, et a lui seul.
    if (id && enfant?.id) {
      const pp = (await (await api(`parent_profiles?select=id&user_id=eq.${id}`)).json())[0];
      const liens = pp ? await (await api(`parent_player_relationships?select=player_id,statut&parent_id=eq.${pp.id}`)).json() : [];
      t("le parent est rattache a l'enfant designe par le club", liens.some((l) => l.player_id === enfant.id && l.statut === "confirme"),
        JSON.stringify(liens));
      t("et a lui seul", liens.length === 1, `${liens.length} rattachement(s)`);

      const j = await jeton(email);
      const lire = (c) => fetch(`${SB}/rest/v1/${c}`, { headers: { apikey: ANON, Authorization: `Bearer ${j.acces}` } }).then((r) => r.json());
      const fiche = await lire(`player_profiles?select=id,nom&id=eq.${enfant.id}`);
      t("il voit la fiche de son enfant", Array.isArray(fiche) && fiche.length === 1, JSON.stringify(fiche));
      const staff = await lire("profiles?select=id,telephone");
      t("il ne lit ni l'annuaire interne ni un telephone de collaborateur",
        Array.isArray(staff) ? staff.filter((s) => s.id !== id).length === 0 : true,
        `${Array.isArray(staff) ? staff.filter((s) => s.id !== id).length : "?"} profil(s) d'autrui`);
    }

    t("aucune erreur JavaScript sur le parcours parent", erreurs.length === 0, erreurs.slice(0, 3).join("\n       "));
    await ctx.close();
  }
} finally {
  await navigateur.close();

  // ── Nettoyage, dans l'ordre des dependances, verifie ────────────────────
  for (const id of aNettoyer.comptes) {
    const pp = (await (await api(`parent_profiles?select=id&user_id=eq.${id}`)).json())[0];
    if (pp) {
      await api(`parent_player_relationships?parent_id=eq.${pp.id}`, { method: "DELETE" });
      await api(`parent_profiles?id=eq.${pp.id}`, { method: "DELETE" });
    }
    const pl = await (await api(`player_profiles?select=id&user_id=eq.${id}`)).json();
    for (const p of pl || []) {
      await api(`team_memberships?player_id=eq.${p.id}`, { method: "DELETE" });
      await api(`membership_requests?player_id=eq.${p.id}`, { method: "DELETE" });
      await api(`player_profiles?id=eq.${p.id}`, { method: "DELETE" });
    }
    await api(`connect_profile_settings?user_id=eq.${id}`, { method: "DELETE" });
    await authApi(`admin/users/${id}`, { method: "DELETE" });
  }
  for (const id of aNettoyer.enfants) {
    await api(`parent_player_relationships?player_id=eq.${id}`, { method: "DELETE" });
    await api(`team_memberships?player_id=eq.${id}`, { method: "DELETE" });
    await api(`membership_requests?player_id=eq.${id}`, { method: "DELETE" });
    await api(`player_profiles?id=eq.${id}`, { method: "DELETE" });
  }
  for (const email of aNettoyer.emails) {
    await api(`player_invitations?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
    await api(`parent_invitations?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  }

  const comptes = ((await (await authApi(`admin/users?filter=connect-`)).json())?.users || [])
    .filter((u) => /zz-(joueur|parent)-connect-/.test(u.email));
  const fiches = await (await api("player_profiles?select=id&nom=like.ZZ*")).json();
  const invits = [
    ...(await (await api("player_invitations?select=id&email=like.zz-*")).json()),
    ...(await (await api("parent_invitations?select=id&email=like.zz-*")).json()),
  ];
  t("aucun compte, fiche ni invitation de test ne subsiste",
    comptes.length === 0 && (fiches?.length ?? 0) === 0 && invits.length === 0,
    `${comptes.length} compte(s), ${fiches?.length ?? 0} fiche(s), ${invits.length} invitation(s) — A NETTOYER A LA MAIN`);
}

process.exit(bilan() ? 1 : 0);
