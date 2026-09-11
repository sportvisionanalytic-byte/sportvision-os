// Données restreintes d'un club, par le chemin réel : PostgREST avec le vrai jeton de chaque
// personne, puis les écrans de Club+ dans un vrai navigateur. Décisions de Fouka du 11/09/2026.
//
//   1. Identifiants Stripe : Owner Club+, Président (+ Admin SportVision, Compta dans l'OS).
//      SIRET : les mêmes, plus Secrétaire et Trésorier. Jamais le CM SportVision.
//   2. Coordonnées des AUTRES membres (téléphone ; e-mail d'un encadrant invité) : Owner Club+,
//      Président, CM SportVision du club, CM externe (depuis le 11/09 au soir), Secrétaire,
//      Trésorier. Chacun lit sa propre fiche.
//   3. Sponsors et montants : Owner Club+, Président, CM SportVision du club, CM externe (idem),
//      Secrétaire, Trésorier, Responsable sponsors.
//
// POURQUOI CE TEST, EN PLUS DU TEST SQL. tests/club-donnees-restreintes.test.sql prouve les
// migrations AVANT leur exécution, en transaction annulée. Celui-ci prouve, APRÈS, que la base de
// production répond bien ainsi à de vrais jetons — l'API Management s'exécute en postgres et
// répondrait oui à tout. Il est ROUGE tant que les deux migrations ne sont pas exécutées : c'est
// la preuve qu'elles ont pris, à rejouer juste après (et après tout changement de ces règles).
//
// Il affirme les décisions, ni plus ni moins : chaque « lit » attendu est un contrôle positif
// (l'Owner Club+ lit chaque valeur témoin — sinon on mesurerait le vide), chaque « ne lit pas »
// est cherché par TOUS les chemins (table, vue clubs_safe, fonctions). Il vérifie aussi que les
// requêtes des écrans adaptés répondent, et que toute colonne autre que les quatre fermées reste
// lisible : une colonne ajoutée à `clubs` ou `club_members` sans `grant select` le fait échouer.
//
//   node livrables/SportVision-TV/tests/club-donnees-restreintes.test.mjs
//   SEULEMENT=DONNEES node …            (sans navigateur)
//   SEULEMENT=ECRANS LOCAL=http://127.0.0.1:3400 node …   (Club+ servi en local)
//
// PROPRETÉ. Club de test « Villeneuve 340 SC » uniquement. Comptes zz-restreint-<objet>-<T0>@
// example.invalid créés par l'API d'administration (aucun e-mail). Valeurs témoins (SIRET,
// identifiants Stripe fictifs « cus_ZZ… », jamais connus de Stripe) posées sur le club le temps
// du test, puis l'état d'origine est rétabli. Tout est supprimé à la fin, et la suppression est
// vérifiée : comptes, rattachements, profils, affectation CM, famille Connect, sponsor, invitation,
// journal du club.

import { rapporteur, SB, ANON, enTeteAdmin } from "./_session-os.mjs";

const LOCAL = (process.env.LOCAL || "").replace(/\/+$/, "");
const CP = LOCAL || "https://clubplus.sportvision-an.fr";
const SEULEMENT = (process.env.SEULEMENT || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const doit = (partie) => SEULEMENT.length === 0 || SEULEMENT.includes(partie);
const CLUB_NOM = "Villeneuve 340 SC";
const T0 = Date.now();
const MDP = `ZzRestreint!${T0}`;
const { t, bilan } = rapporteur();

// Valeurs témoins. Le SIRET est unique en base (clubs_siret_norm_uniq) : il porte l'heure du test.
const TEMOIN = {
  siret: `999 ${String(T0).slice(-11, -8)} ${String(T0).slice(-8, -5)} ${String(T0).slice(-5)}`,
  stripe_customer_id: `cus_ZZRESTREINT${T0}`,
  stripe_subscription_id: `sub_ZZRESTREINT${T0}`,
  telCible: "06 99 99 99 99",
  sponsor: `ZZ Sponsor restreint ${T0}`,
  montant: 4321,
  operation: `ZZ Opération restreinte ${T0}`,
  invite: `zz-restreint-invite-${T0}@example.invalid`,
};

const traces = { emails: new Set(), comptes: new Set(), club: null, origine: null };
const adresse = (objet) => {
  const e = `zz-restreint-${objet}-${T0}@example.invalid`;
  traces.emails.add(e);
  return e;
};

// ── Accès service : décor et nettoyage uniquement, jamais pour une mesure de droits ──
const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, {
    ...opts,
    headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) },
  });
const lire = async (chemin) => {
  const r = await api(chemin);
  return r.ok ? r.json() : [];
};
const ecrire = async (chemin, method, body) => {
  const r = await api(chemin, { method, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${chemin.split("?")[0]} : ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? [] : r.json();
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

async function creerCompte(objet) {
  const email = adresse(objet);
  const d = await (await auth("admin/users", { method: "POST", body: JSON.stringify({ email, password: MDP, email_confirm: true }) })).json();
  if (!d.id) throw new Error(`création du compte ${objet} impossible : ${JSON.stringify(d).slice(0, 160)}`);
  traces.comptes.add(d.id);
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: MDP }),
  });
  const jeton = (await r.json()).access_token;
  if (!jeton) throw new Error(`aucun jeton pour ${objet}`);
  return { id: d.id, email, jeton };
}

// ── Le chemin réel : PostgREST avec le jeton de la personne ──
async function comme(jeton, chemin, { method = "GET", body } = {}) {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texte = await r.text();
  let data = null;
  try { data = JSON.parse(texte); } catch { data = texte; }
  return { status: r.status, data };
}
const rpc = (jeton, fn, body) => comme(jeton, `rpc/${fn}`, { method: "POST", body });
// Ce qu'une réponse contient, pour le rapport : la valeur, « refus 403 », ou « vide ».
const resume = (r) => (r.status >= 400 ? `refus ${r.status}` : JSON.stringify(r.data).slice(0, 90));

// ── Décor ────────────────────────────────────────────────────────────────────────────────────
const ROLES_CLUB = ["admin", "president", "secretaire", "tresorier", "sponsor_mgr", "coach", "resp_equipe",
  "directeur_sportif", "comm", "lecture_seule", "membre_bureau", "administratif", "cm_externe"];

async function preparer() {
  const club = (await lire(`clubs?select=id,nom,instagram_handle,siret,stripe_customer_id,stripe_subscription_id&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
  if (!club) throw new Error(`club ${CLUB_NOM} introuvable`);
  traces.club = club.id;
  traces.origine = { siret: club.siret, stripe_customer_id: club.stripe_customer_id, stripe_subscription_id: club.stripe_subscription_id };
  const equipe = (await lire(`club_teams?select=id,name&club_id=eq.${club.id}&archivee=eq.false&order=name&limit=1`))[0];
  if (!equipe) throw new Error("aucune équipe sur le club de test");

  await ecrire(`clubs?id=eq.${club.id}`, "PATCH", {
    siret: TEMOIN.siret, stripe_customer_id: TEMOIN.stripe_customer_id, stripe_subscription_id: TEMOIN.stripe_subscription_id,
  });

  const personnes = {};
  let n = 10;
  for (const role of ROLES_CLUB) {
    const p = await creerCompte(role.replace(/_/g, ""));
    const teams = ["coach", "resp_equipe", "directeur_sportif"].includes(role) ? [equipe.name] : [];
    const ligne = (await ecrire("club_members", "POST", {
      user_id: p.id, club_id: club.id, role, status: "actif", prenom: "ZZ", nom: `Restreint ${role}`, telephone: `06 00 00 00 ${n++}`, teams,
    }))[0];
    personnes[role] = { ...p, ligne: ligne.id };
  }
  // La cible de « lit-il le téléphone d'un AUTRE membre » : jamais incarnée.
  const cible = await creerCompte("cible");
  const ligneCible = (await ecrire("club_members", "POST", {
    user_id: cible.id, club_id: club.id, role: "lecture_seule", status: "actif", prenom: "ZZ", nom: "Cible", telephone: TEMOIN.telCible,
  }))[0];

  // Le CM SportVision affecté au club.
  const cm = await creerCompte("cm");
  await ecrire("profiles", "POST", { id: cm.id, role: "cm", prenom: "ZZ", nom: "CM Restreint", email: cm.email, actif: true });
  await ecrire("club_cm_affectations", "POST", { club_id: club.id, cm_id: cm.id, role: "principal", actif: true });
  personnes.cm_sportvision = cm;

  // Une famille Connect du club : un joueur de l'équipe, son parent confirmé.
  const joueur = await creerCompte("joueur");
  const pp = (await ecrire("player_profiles", "POST", {
    club_id: club.id, user_id: joueur.id, prenom: "ZZ", nom: "Joueur Restreint", date_naissance: "2010-01-01", account_status: "actif",
  }))[0];
  personnes.joueur_connect = joueur;
  const parent = await creerCompte("parent");
  const par = (await ecrire("parent_profiles", "POST", { user_id: parent.id, prenom: "ZZ", nom: "Parent Restreint" }))[0];
  await ecrire("parent_player_relationships", "POST", { parent_id: par.id, player_id: pp.id, statut: "confirme" });
  personnes.parent_connect = parent;

  const sponsor = (await ecrire("club_sponsors", "POST", { club_id: club.id, name: TEMOIN.sponsor, montant: TEMOIN.montant }))[0];
  const operation = (await ecrire("sponsor_operations", "POST", { sponsor_id: sponsor.id, label: TEMOIN.operation, date: new Date().toISOString().slice(0, 10) }))[0];
  const invitation = (await ecrire("club_invitations", "POST", { club_id: club.id, email: TEMOIN.invite, role: "coach", teams: [equipe.name] }))[0];

  return { club, equipe, personnes, cible: { ...cible, ligne: ligneCible.id }, sponsor, operation, invitation, joueurProfil: pp, parentProfil: par };
}

// ── 1. DONNÉES ───────────────────────────────────────────────────────────────────────────────
// Les listes des décisions. Tout le monde n'y figurant pas doit « ne pas lire ».
// cm_externe (CM invité directement par le club) : ajouté à l'annuaire et aux sponsors le 11/09 au
// soir, décision de Fouka « mêmes droits que le CM SportVision » (migration-blocages-review-1). Il
// reste hors du SIRET et de Stripe, comme le CM SportVision, et n'ouvre pas la fiche d'équipe
// (equipe_apercu), d'où « e-mail invité » inchangé.
const LISTES = {
  stripe: ["admin", "president"],
  siret: ["admin", "president", "secretaire", "tresorier"],
  annuaire: ["admin", "president", "secretaire", "tresorier", "cm_sportvision", "cm_externe"],
  "e-mail invité": ["admin", "president", "cm_sportvision"],
  sponsors: ["admin", "president", "secretaire", "tresorier", "sponsor_mgr", "cm_sportvision", "cm_externe"],
  montants: ["admin", "president", "secretaire", "tresorier", "sponsor_mgr", "cm_sportvision", "cm_externe"],
  "opérations sponsor": ["admin", "president", "secretaire", "tresorier", "sponsor_mgr", "cm_sportvision", "cm_externe"],
};

async function mesurerDonnees(d) {
  console.log("\n1. DONNÉES — ce que la base rend à chaque personne, avec son propre jeton");
  const c = d.club.id;
  const releve = {};
  for (const [qui, p] of Object.entries(d.personnes)) {
    const j = p.jeton;
    const m = (releve[qui] = {});
    const contient = (reponses, temoin) => reponses.some((r) => r.status < 300 && JSON.stringify(r.data).includes(temoin));

    // Décision 1 : la table, la fonction, la vue, la détection de doublons.
    const table = await comme(j, `clubs?select=stripe_customer_id,stripe_subscription_id,siret&id=eq.${c}`);
    const tableStripe = await comme(j, `clubs?select=stripe_customer_id,stripe_subscription_id&id=eq.${c}`);
    const tableSiret = await comme(j, `clubs?select=siret&id=eq.${c}`);
    const fn = await rpc(j, "club_donnees_restreintes", { p_club_id: c });
    const vue = await comme(j, `clubs_safe?select=siret,stripe_customer_id,stripe_subscription_id&id=eq.${c}`);
    const doublons = await rpc(j, "find_duplicate_club_candidates", { p_siret: null, p_nom: CLUB_NOM, p_exclude_client_id: null });
    m.stripe = { lit: contient([table, tableStripe, fn, vue], "ZZRESTREINT"), detail: `table ${resume(tableStripe)} · fonction ${resume(fn)}` };
    m.siret = { lit: contient([table, tableSiret, fn, vue, doublons], TEMOIN.siret), detail: `table ${resume(tableSiret)} · doublons ${resume(doublons)}` };

    // Décision 2 : le téléphone d'un autre membre, le sien, l'e-mail d'un encadrant invité.
    const telTable = await comme(j, `club_members?select=telephone&id=eq.${d.cible.ligne}`);
    const telFn = await rpc(j, "club_membres_coordonnees", { p_club_id: c });
    m.annuaire = { lit: contient([telTable, telFn], TEMOIN.telCible), detail: `table ${resume(telTable)} · fonction ${resume(telFn)}` };
    if (p.ligne) {
      const soiTable = await comme(j, `club_members?select=telephone&id=eq.${p.ligne}`);
      m["sa fiche"] = { lit: contient([soiTable, telFn], "06 00 00 00"), detail: `table ${resume(soiTable)}` };
    }
    const apercu = await rpc(j, "equipe_apercu", { p_team_id: d.equipe.id });
    m["e-mail invité"] = { lit: contient([apercu], TEMOIN.invite), detail: apercu.status >= 400 ? `refus ${apercu.status}` : "fiche d'équipe lue" };

    // Décision 3 : le sponsor, son montant, ses opérations.
    const sp = await comme(j, `club_sponsors?select=id,name,montant&id=eq.${d.sponsor.id}`);
    m.sponsors = { lit: contient([sp], TEMOIN.sponsor), detail: resume(sp) };
    m.montants = { lit: contient([sp], String(TEMOIN.montant)), detail: resume(sp) };
    const op = await comme(j, `sponsor_operations?select=label&id=eq.${d.operation.id}`);
    m["opérations sponsor"] = { lit: contient([op], TEMOIN.operation), detail: resume(op) };

    for (const [donnee, v] of Object.entries(m)) {
      const attendu = donnee === "sa fiche" ? true : LISTES[donnee].includes(qui);
      t(`[${qui}] ${donnee} : ${attendu ? "lit" : "ne lit pas"}`, v.lit === attendu, `obtenu : ${v.lit ? "lit" : "ne lit pas"} — ${v.detail}`);
    }
  }

  // Le relevé, pour le rapport.
  console.log("\n   Relevé (L = lit, · = ne lit pas) :");
  const cols = ["stripe", "siret", "annuaire", "sa fiche", "e-mail invité", "sponsors", "montants", "opérations sponsor"];
  console.log(`   ${"".padEnd(18)} ${cols.map((x) => x.slice(0, 9).padEnd(10)).join("")}`);
  for (const [qui, m] of Object.entries(releve)) {
    console.log(`   ${qui.padEnd(18)} ${cols.map((x) => (m[x] ? (m[x].lit ? "L" : "·") : "-").padEnd(10)).join("")}`);
  }
  return releve;
}

// ── 2. LES REQUÊTES DES ÉCRANS ─────────────────────────────────────────────────────────────
// Après la migration 2, une requête qui demande une colonne fermée échoue ENTIÈRE (42501). On
// rejoue celles des écrans adaptés, avec leur liste exacte, pour les rôles qui les ouvrent.
async function mesurerEcransDonnees(d) {
  console.log("\n2. REQUÊTES DES ÉCRANS — elles répondent pour chaque rôle qui les envoie");
  const c = d.club.id;
  const P = d.personnes;
  const SESSION = "id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved, portail_client_id, logo_url, ecusson_url, adresse, instagram_handle, couleur_primaire, couleur_secondaire, club_plus_source";
  for (const qui of [...ROLES_CLUB, "cm_sportvision"]) {
    const j = P[qui].jeton;
    const s = await comme(j, `clubs?select=${encodeURIComponent(SESSION.replace(/\s/g, ""))}&id=eq.${c}`);
    t(`[${qui}] session Club+ (clubs, sans SIRET)`, s.status === 200 && s.data.length === 1, resume(s));
    const u = await comme(j, `club_members?select=id,user_id,prenom,nom,role,status,created_at,teams,fonction&club_id=eq.${c}`);
    t(`[${qui}] liste des membres (sans téléphone)`, u.status === 200 && u.data.length > 0, resume(u));
  }
  for (const qui of ["admin", "president"]) {
    const j = P[qui].jeton;
    const o = await comme(j, `clubs?select=plan,engagement,pilot_mode,credits_monthly,credits_balance,subscription_status&id=eq.${c}`);
    const f = await rpc(j, "club_donnees_restreintes", { p_club_id: c });
    t(`[${qui}] « Mon offre » : formule et abonnement Stripe`, o.status === 200 && o.data.length === 1 && f.status === 200 && f.data?.[0]?.stripe_subscription_id === TEMOIN.stripe_subscription_id, `${resume(o)} · ${resume(f)}`);
  }
  const tres = await rpc(P.tresorier.jeton, "club_donnees_restreintes", { p_club_id: c });
  t("[tresorier] lit le SIRET du club", tres.status === 200 && tres.data?.[0]?.siret === TEMOIN.siret && tres.data?.[0]?.siret_lisible === true, resume(tres));
  const cmR = await rpc(P.cm_sportvision.jeton, "club_donnees_restreintes", { p_club_id: c });
  t("[cm_sportvision] ne reçoit ni SIRET ni Stripe (aucune ligne)", cmR.status === 200 && Array.isArray(cmR.data) && cmR.data.length === 0, resume(cmR));

  // Le Responsable sponsors gère toujours les sponsors : ajoute et modifie.
  const ajout = await comme(P.sponsor_mgr.jeton, "club_sponsors", { method: "POST", body: { club_id: c, name: `ZZ Sponsor ajouté ${T0}` } });
  const maj = await comme(P.sponsor_mgr.jeton, `club_sponsors?id=eq.${d.sponsor.id}`, { method: "PATCH", body: { secteur: "zz" } });
  t("[sponsor_mgr] ajoute et modifie un sponsor", ajout.status < 300 && maj.status < 300 && maj.data?.length === 1, `${resume(ajout)} · ${resume(maj)}`);

  // Écritures de l'Owner Club+ telles que Club+ les envoie (retour `select=id`).
  // Même valeur réécrite : l'écriture est mesurée sans rien changer au club.
  const e1 = await comme(P.admin.jeton, `clubs?id=eq.${c}&select=id`, { method: "PATCH", body: { instagram_handle: d.club.instagram_handle } });
  t("[admin] enregistre la fiche du club (retour select=id)", e1.status === 200 && e1.data?.length === 1, resume(e1));
  const e2 = await comme(P.admin.jeton, `club_members?id=eq.${d.cible.ligne}&select=id`, { method: "PATCH", body: { status: "actif" } });
  t("[admin] modifie le statut d'un membre (retour select=id)", e2.status === 200 && e2.data?.length === 1, resume(e2));

  // Aucune colonne oubliée : toutes, sauf les quatre fermées, restent lisibles (la liste vient du
  // schéma publié par PostgREST lui-même, lu avec la clé de service).
  const schema = await (await fetch(`${SB}/rest/v1/`, { headers: enTeteAdmin })).json();
  const FERMEES = { clubs: ["siret", "stripe_customer_id", "stripe_subscription_id"], club_members: ["telephone"] };
  for (const [table, fermees] of Object.entries(FERMEES)) {
    const colonnes = Object.keys(schema?.definitions?.[table]?.properties || {}).filter((x) => !fermees.includes(x));
    const r = await comme(P.admin.jeton, `${table}?select=${colonnes.join(",")}&${table === "clubs" ? "id" : "club_id"}=eq.${c}&limit=1`);
    t(`[admin] ${table} : les ${colonnes.length} colonnes non fermées restent lisibles`, colonnes.length > 5 && r.status === 200, resume(r));
    const etoile = await comme(P.admin.jeton, `${table}?select=*&limit=1`);
    t(`[admin] ${table}?select=* est refusé (colonne fermée : tout lecteur nomme ses colonnes)`, etoile.status === 401 || etoile.status === 403, resume(etoile));
  }
}

// ── 3. ÉCRANS DE CLUB+ ───────────────────────────────────────────────────────────────────────
async function connecter(nav, email) {
  // SANS_CSP=1 : seulement pour une app locale construite contre un autre hôte Supabase (proxy de
  // simulation) — la CSP de Club+ n'autorise que l'hôte de production.
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR", bypassCSP: process.env.SANS_CSP === "1" });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
  await page.goto(`${CP}/clubplus/auth/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(MDP);
  await page.locator("button", { hasText: "Se connecter" }).first().click();
  await page.waitForSelector("aside nav a", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  return { ctx, page, erreurs };
}
const aller = async (page, chemin) => {
  await page.goto(`${CP}/clubplus${chemin}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  return page.evaluate(() => document.body?.innerText || "");
};
const bruit = (l) => l.filter((e) => !/favicon|status of 40[134]|Download the React DevTools|ResizeObserver loop/i.test(e));

async function mesurerEcrans(d) {
  const { chromium } = await import("../../SportVision-Connect/app-next/node_modules/playwright/index.mjs");
  console.log(`\n3. ÉCRANS — ${CP}`);
  const nav = await chromium.launch();
  const P = d.personnes;
  try {
    // Owner Club+ : Paramètres > Organisation montre le SIRET et les téléphones de l'organigramme.
    {
      const { ctx, page, erreurs } = await connecter(nav, P.admin.email);
      const texte = await aller(page, "/settings/organization");
      const siret = await page.locator("label", { hasText: "SIRET" }).locator("input").inputValue().catch(() => null);
      t("[admin] Paramètres > Organisation : SIRET affiché", siret === TEMOIN.siret, `champ : ${siret}`);
      t("[admin] organigramme : téléphone d'un autre membre affiché", texte.includes(TEMOIN.telCible), texte.slice(0, 120).replace(/\s+/g, " "));
      await aller(page, "/users");
      t("[admin] aucune erreur JavaScript (Paramètres, Coachs & dirigeants)", bruit(erreurs).length === 0, bruit(erreurs).slice(0, 3).join(" · "));
      await ctx.close();
    }
    // Administratif : il voit cette page en lecture, sans SIRET ni téléphone.
    {
      const { ctx, page, erreurs } = await connecter(nav, P.administratif.email);
      const texte = await aller(page, "/settings/organization");
      const champs = await page.locator("label", { hasText: "SIRET" }).count();
      t("[administratif] Paramètres > Organisation : pas de champ SIRET", champs === 0 && !texte.includes(TEMOIN.siret), `${champs} champ(s)`);
      t("[administratif] organigramme : aucun téléphone", !texte.includes(TEMOIN.telCible) && !/06 00 00 00/.test(texte), "");
      t("[administratif] contrôle : l'organigramme est bien affiché (noms)", texte.includes("Rôle et nom") && texte.includes("Cible"), texte.slice(0, 160).replace(/\s+/g, " "));
      t("[administratif] aucune erreur JavaScript", bruit(erreurs).length === 0, bruit(erreurs).slice(0, 3).join(" · "));
      await ctx.close();
    }
    // CM SportVision : l'onboarding « Identité » n'a plus de champ SIRET, et enregistre.
    {
      const { ctx, page, erreurs } = await connecter(nav, P.cm_sportvision.email);
      // Affecté à un seul club, le CM y entre directement (pickActiveSpace) ; sinon on le choisit.
      const carte = page.locator(`text=${CLUB_NOM}`).first();
      if (await carte.isVisible().catch(() => false)) { await carte.click().catch(() => {}); await page.waitForTimeout(7000); }
      const texte = await aller(page, "/onboarding?section=identite");
      const champs = await page.locator("label", { hasText: "SIRET" }).count();
      t("[cm_sportvision] onboarding Identité : pas de champ SIRET", champs === 0 && !texte.includes(TEMOIN.siret), `${champs} champ(s)`);
      const enregistrer = page.locator("button", { hasText: "Enregistrer" }).first();
      if (await enregistrer.count()) {
        await enregistrer.click();
        await page.waitForTimeout(3000);
        const apres = await page.evaluate(() => document.body?.innerText || "");
        t("[cm_sportvision] onboarding Identité : enregistre sans erreur", apres.includes("Enregistré.") && !/refus|Impossible/i.test(apres), apres.slice(0, 160).replace(/\s+/g, " "));
        const siretApres = (await lire(`clubs?select=siret&id=eq.${d.club.id}`))[0]?.siret;
        t("[cm_sportvision] le SIRET du club n'a pas bougé", siretApres === TEMOIN.siret, `SIRET en base : ${siretApres}`);
      } else {
        t("[cm_sportvision] onboarding Identité : bouton Enregistrer présent", false, texte.slice(0, 160).replace(/\s+/g, " "));
      }
      const membres = await aller(page, "/users");
      t("[cm_sportvision] Membres : la liste s'affiche", membres.includes("Cible"), membres.slice(0, 160).replace(/\s+/g, " "));
      t("[cm_sportvision] aucune erreur JavaScript", bruit(erreurs).length === 0, bruit(erreurs).slice(0, 3).join(" · "));
      await ctx.close();
    }
    // Responsable sponsors : il voit le sponsor. Coach : même par l'adresse directe, rien.
    for (const [qui, voit] of [["sponsor_mgr", true], ["coach", false]]) {
      const { ctx, page, erreurs } = await connecter(nav, P[qui].email);
      const texte = await aller(page, "/sponsors");
      t(`[${qui}] /sponsors : ${voit ? "voit" : "ne voit pas"} le sponsor`, texte.includes(TEMOIN.sponsor) === voit, texte.slice(0, 120).replace(/\s+/g, " "));
      t(`[${qui}] aucune erreur JavaScript`, bruit(erreurs).length === 0, bruit(erreurs).slice(0, 3).join(" · "));
      await ctx.close();
    }
    // Président : « Mon offre » et l'accueil s'ouvrent sans erreur.
    {
      const { ctx, page, erreurs } = await connecter(nav, P.president.email);
      const texte = await aller(page, "/billing");
      t("[president] Factures : la carte « Mon offre » s'affiche", texte.includes("Mon offre"), texte.slice(0, 120).replace(/\s+/g, " "));
      t("[president] aucune erreur JavaScript", bruit(erreurs).length === 0, bruit(erreurs).slice(0, 3).join(" · "));
      await ctx.close();
    }
  } finally {
    await nav.close();
  }
}

// ── Nettoyage, vérifié ───────────────────────────────────────────────────────────────────────
async function nettoyer(d) {
  const del = (chemin) => api(chemin, { method: "DELETE" });
  const club = traces.club;
  if (club && traces.origine) await api(`clubs?id=eq.${club}`, { method: "PATCH", body: JSON.stringify(traces.origine) });
  if (d?.invitation) await del(`club_invitations?id=eq.${d.invitation.id}`);
  await del(`club_invitations?email=eq.${encodeURIComponent(TEMOIN.invite)}`);
  if (club) await del(`club_sponsors?club_id=eq.${club}&name=like.ZZ*${T0}*`);
  if (d?.parentProfil) await del(`parent_player_relationships?parent_id=eq.${d.parentProfil.id}`);
  for (const id of traces.comptes) {
    await del(`player_profiles?user_id=eq.${id}`);
    await del(`parent_profiles?user_id=eq.${id}`);
    await del(`club_cm_affectations?cm_id=eq.${id}`);
    await del(`club_members?user_id=eq.${id}`);
    await del(`memberships?user_id=eq.${id}`);
    await del(`notifications?destinataire_id=eq.${id}`);
    if (club) await del(`club_onboarding_events?club_id=eq.${club}&auteur_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  }
  // Le journal du club : témoins (identité), sponsor, invitation — lignes datées du test.
  if (club) await del(`club_onboarding_events?club_id=eq.${club}&created_at=gte.${new Date(T0).toISOString()}`);

  const restes = [];
  for (const id of traces.comptes) {
    const u = await (await auth(`admin/users/${id}`)).json().catch(() => ({}));
    if (u?.id) restes.push(`compte ${u.email}`);
    for (const tb of ["club_members?user_id", "memberships?user_id", "profiles?id", "player_profiles?user_id", "parent_profiles?user_id", "club_cm_affectations?cm_id"]) {
      if ((await lire(`${tb}=eq.${id}&select=*`)).length) restes.push(`${tb.split("?")[0]} ${id}`);
    }
  }
  if (club) {
    const c = (await lire(`clubs?select=siret,stripe_customer_id,stripe_subscription_id&id=eq.${club}`))[0] || {};
    for (const k of ["siret", "stripe_customer_id", "stripe_subscription_id"]) {
      if ((c[k] ?? null) !== (traces.origine?.[k] ?? null)) restes.push(`clubs.${k} non rétabli`);
    }
    if ((await lire(`club_sponsors?select=id&club_id=eq.${club}&name=like.ZZ*`)).length) restes.push("sponsor ZZ");
    if ((await lire(`club_invitations?select=id&email=eq.${encodeURIComponent(TEMOIN.invite)}`)).length) restes.push("invitation");
    if ((await lire(`club_onboarding_events?select=id&club_id=eq.${club}&created_at=gte.${new Date(T0).toISOString()}`)).length) restes.push("journal du club");
  }
  t("nettoyage : aucune trace (comptes, rattachements, famille, CM, sponsor, invitation, témoins, journal)", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
}

let decor = null;
try {
  decor = await preparer();
  if (doit("DONNEES")) {
    await mesurerDonnees(decor);
    await mesurerEcransDonnees(decor);
  }
  if (doit("ECRANS")) await mesurerEcrans(decor);
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.stack || e).split("\n").slice(0, 3).join(" · "));
} finally {
  await nettoyer(decor);
}
process.exit(bilan() ? 1 : 0);
