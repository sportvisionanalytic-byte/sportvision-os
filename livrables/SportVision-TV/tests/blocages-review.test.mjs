// Les cinq blocages de l'audit Review du 11/09/2026, vérifiés sur la PRODUCTION par le chemin réel.
//
//   1. Le CM externe (club_members.role = 'cm_externe') lit l'annuaire et les sponsors, jamais le
//      SIRET ni Stripe. Décision de Fouka. migration-blocages-review-1.
//   2. club_calendrier : un coach ne reçoit que ses équipes et le club, plus tout le calendrier.
//      Décision de Fouka (même règle que la v124). migration-blocages-review-2.
//   3. Connect, « Mes espaces » : le lien vers Club+ n'existe que pour qui a un rôle dans Club+
//      (club_members). Comportement voulu : un joueur ou un parent n'en a pas, un coach si.
//   4. connect-player-prestations : pas de défaut CORS en production (préflight, en-têtes). Mais
//      « Mes commandes » et « Factures & paiements » d'un JOUEUR rattaché à un club échouaient
//      quand même : le déclencheur proteger_identite_joueur (v109) refusait le premier rattachement
//      de sa fiche à son client. migration-blocages-review-4. Le parent n'était pas touché.
//   5. Timeouts 57014 : cause mesurée (fonctions SQL imbriquées re-planifiées à chaque ligne de
//      policy), peut_operer_club et peut_lire_calendrier_equipe réécrites à l'identique.
//      migration-blocages-review-3.
//
// QUATRE PARTIES.
//   SQL     — tests/blocages-review.test.sql en transaction annulée : points 1, 2 et l'équivalence
//             du point 5 ; tests/blocages-review-client-joueur.test.sql : point 4.
//             AVEC_MIGRATION=1 y injecte les quatre migrations (rouge sans, vert avec).
//   PERF    — tests/blocages-review-perf.test.sql : le coût par rôle avant/après, sur un volume
//             proche de Review injecté le temps de la transaction.
//   DONNEES — PostgREST et la fonction serveur avec le VRAI jeton de chaque personne, sur la base
//             de production. Rouge sur les points 1 et 2 tant que les migrations ne sont pas
//             exécutées : c'est la preuve qu'elles ont pris, à rejouer juste après.
//   ECRANS  — Connect et Club+ en ligne, dans un vrai navigateur.
//
//   node livrables/SportVision-TV/tests/blocages-review.test.mjs
//   SEULEMENT=SQL,PERF AVEC_MIGRATION=1 node …          (avant exécution : preuve des migrations)
//   SEULEMENT=DONNEES,ECRANS node …                     (après exécution : chemin réel)
//   CX=http://127.0.0.1:3312 CP=http://127.0.0.1:3313 … (apps servies en local contre la vraie base)
//
// PROPRETÉ. Club de test « Villeneuve 340 SC » uniquement. Comptes zz-blocages-<objet>-<T0>@
// example.invalid créés par l'API d'administration (aucun e-mail). Tout ce qui est créé (comptes,
// rattachements, famille Connect, affectation CM, sponsor, événements, journal du club) est
// supprimé à la fin, et la suppression est vérifiée.

import { readFileSync } from "node:fs";
import { rapporteur, SB, ANON, enTeteAdmin, env } from "./_session-os.mjs";

const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const CP = (process.env.CP || "https://clubplus.sportvision-an.fr").replace(/\/+$/, "");
const CX = (process.env.CX || "https://connect.sportvision-an.fr").replace(/\/+$/, "");
const ORIGINE_CONNECT = "https://connect.sportvision-an.fr";
const SEULEMENT = (process.env.SEULEMENT || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const doit = (partie) => SEULEMENT.length === 0 || SEULEMENT.includes(partie);
const AVEC_MIGRATION = process.env.AVEC_MIGRATION === "1";
const MIGRATIONS = [
  "migration-blocages-review-1-cm-externe-annuaire-sponsors.sql",
  "migration-blocages-review-2-calendrier-roles-equipe.sql",
  "migration-blocages-review-3-rls-evaluation-unique.sql",
  "migration-blocages-review-4-client-joueur.sql",
];
const CLUB_NOM = "Villeneuve 340 SC";
const T0 = Date.now();
const MDP = `ZzBlocages!${T0}`;
const TEMOIN = { tel: "06 98 76 54 32", sponsor: `ZZ Sponsor blocages ${T0}`, montant: 4321, operation: `ZZ Opération blocages ${T0}` };
const { t, bilan } = rapporteur();
const ici = (f) => new URL(f, import.meta.url).pathname;

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
const ecrire = async (chemin, body) => {
  const r = await api(chemin, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${chemin} : ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json())[0];
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

const traces = { comptes: [], club: null };
async function creerCompte(objet) {
  const email = `zz-blocages-${objet}-${T0}@example.invalid`;
  // Prénom et nom dans les métadonnées, comme après une vraie inscription Connect : sans eux,
  // connect_resolve_beneficiary_client_id crée un client sans nom et échoue (voir le rapport).
  const d = await (await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: MDP, email_confirm: true, user_metadata: { first_name: "ZZ", last_name: `Blocages ${objet}` } }),
  })).json();
  if (!d.id) throw new Error(`création du compte ${objet} impossible : ${JSON.stringify(d).slice(0, 160)}`);
  traces.comptes.push(d.id);
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: MDP }),
  });
  const jeton = (await r.json()).access_token;
  if (!jeton) throw new Error(`aucun jeton pour ${objet}`);
  return { id: d.id, email, jeton };
}

// ── Le chemin réel : PostgREST avec le jeton de la personne ──
async function comme(jeton, chemin, { method = "GET", body } = {}) {
  const t0 = Date.now();
  const r = await fetch(`${SB}/rest/v1/${chemin}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texte = await r.text();
  let data = null;
  try { data = JSON.parse(texte); } catch { data = texte; }
  return { status: r.status, data, ms: Date.now() - t0 };
}
const rpc = (jeton, fn, body) => comme(jeton, `rpc/${fn}`, { method: "POST", body });
const resume = (r) => (r.status >= 400 ? `refus ${r.status}` : JSON.stringify(r.data).slice(0, 110));

// ── 0. SQL et PERF : transaction annulée, migrations injectées ou non ────────────────────────
async function jouerSql(fichier, titre) {
  console.log(`\n${titre} — ${fichier} (${AVEC_MIGRATION ? "avec les quatre migrations" : "base actuelle, sans migration"})`);
  let sql = readFileSync(ici(`./${fichier}`), "utf8");
  const migration = AVEC_MIGRATION
    ? MIGRATIONS.map((f) => readFileSync(ici(`../${f}`), "utf8").replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, "")).join("\n")
    : "";
  if (/^\s*(begin|commit);\s*$/im.test(migration)) throw new Error("une migration contient encore un begin/commit : elle serait validée");
  if (!sql.includes("-- @@MIGRATIONS@@")) throw new Error(`${fichier} : marqueur @@MIGRATIONS@@ absent`);
  sql = sql.replace("-- @@MIGRATIONS@@", () => migration);
  if (!/\nrollback;\s*$/.test(sql)) throw new Error(`${fichier} : le test doit se terminer par rollback`);
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const d = await r.json().catch(() => null);
  if (!Array.isArray(d)) { t(`${fichier} s'exécute`, false, String(d?.message || JSON.stringify(d)).slice(0, 600)); return; }
  for (const v of d) {
    if (v.attendu === "relevé") console.log(`       ${v.controle} : ${v.obtenu.replace(/^relevé {2}— /, "")}`);
    else t(`${v.controle}`, v.ok === "✅", `attendu ${v.attendu}, obtenu ${v.obtenu}`);
  }
}

// ── Décor du chemin réel ─────────────────────────────────────────────────────────────────────
async function preparer() {
  const club = (await lire(`clubs?select=id,saison&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
  if (!club) throw new Error(`club ${CLUB_NOM} introuvable`);
  traces.club = club.id;
  const equipes = await lire(`club_teams?select=id,name&club_id=eq.${club.id}&archivee=eq.false&order=name&limit=2`);
  if (equipes.length < 2) throw new Error("il faut deux équipes sur le club de test");
  const [equipe, autre] = equipes;

  const P = {};
  // Rôles de club. Les rôles d'équipe sur la PREMIÈRE équipe.
  for (const role of ["president", "coach", "directeur_sportif", "secretaire", "comm", "cm_externe"]) {
    const p = await creerCompte(role.replace(/_/g, ""));
    await ecrire("club_members", {
      user_id: p.id, club_id: club.id, role, status: "actif", prenom: "ZZ", nom: `Blocages ${role}`,
      teams: ["coach", "directeur_sportif"].includes(role) ? [equipe.name] : [],
    });
    P[role] = p;
  }
  // Un membre dont on cherche le téléphone : jamais incarné.
  const cible = await creerCompte("cible");
  const ligneCible = await ecrire("club_members", { user_id: cible.id, club_id: club.id, role: "lecture_seule", status: "actif", prenom: "ZZ", nom: "Cible", telephone: TEMOIN.tel });
  // Le CM SportVision affecté au club.
  const cm = await creerCompte("cm");
  await ecrire("profiles", { id: cm.id, role: "cm", prenom: "ZZ", nom: "CM Blocages", email: cm.email, actif: true });
  await ecrire("club_cm_affectations", { club_id: club.id, cm_id: cm.id, role: "principal", actif: true });
  P.cm_sportvision = cm;

  // Connect : un joueur de la SECONDE équipe, son parent confirmé, et un coach qui a aussi un
  // compte Connect (le témoin positif de « Mes espaces »).
  const joueur = await creerCompte("joueur");
  const pp = await ecrire("player_profiles", { club_id: club.id, user_id: joueur.id, prenom: "ZZ", nom: "Joueur Blocages", date_naissance: "2010-01-01", account_status: "actif" });
  await ecrire("team_memberships", { player_id: pp.id, team_id: autre.id, club_id: club.id, saison: club.saison, statut: "active" });
  await ecrire("connect_profile_settings", { user_id: joueur.id, account_type: "joueur" });
  P.joueur = joueur;
  const parent = await creerCompte("parent");
  const par = await ecrire("parent_profiles", { user_id: parent.id, prenom: "ZZ", nom: "Parent Blocages" });
  await ecrire("parent_player_relationships", { parent_id: par.id, player_id: pp.id, statut: "confirme" });
  await ecrire("connect_profile_settings", { user_id: parent.id, account_type: "particulier" });
  P.parent = parent;
  const coachConnect = await creerCompte("coachconnect");
  await ecrire("club_members", { user_id: coachConnect.id, club_id: club.id, role: "coach", status: "actif", prenom: "ZZ", nom: "Coach Connect", teams: [equipe.name] });
  await ecrire("connect_profile_settings", { user_id: coachConnect.id, account_type: "joueur" });
  P.coach_connect = coachConnect;

  // Un événement du club sans équipe, un sur la seconde équipe : le coach doit voir le premier,
  // jamais le second. Un sponsor et son opération.
  const evtClub = await ecrire("club_calendar_events", { club_id: club.id, title: `ZZ Assemblée ${T0}`, event_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), type: "tournoi" });
  const evtAutre = await ecrire("club_calendar_events", { club_id: club.id, title: `ZZ Tournoi ${T0}`, event_date: new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10), type: "tournoi", team: autre.name, team_id: autre.id });
  const sponsor = await ecrire("club_sponsors", { club_id: club.id, name: TEMOIN.sponsor, montant: TEMOIN.montant });
  const operation = await ecrire("sponsor_operations", { sponsor_id: sponsor.id, label: TEMOIN.operation, date: new Date().toISOString().slice(0, 10) });

  return { club, equipe, autre, P, ligneCible, evtClub, evtAutre, sponsor, operation, parentProfil: par };
}

// ── 1. DONNÉES ───────────────────────────────────────────────────────────────────────────────
async function mesurerDonnees(d) {
  const { club, P, autre } = d;
  const c = club.id;
  console.log("\nDONNÉES — ce que la production rend à chaque personne, avec son propre jeton");

  // Point 1 — CM externe : annuaire et sponsors oui, SIRET et Stripe non. Témoins : Président
  // (lit tout ce que la décision lui donne) et coach (ne lit rien de tout ça).
  console.log("\n  Point 1 — CM externe");
  for (const [qui, lit] of [["cm_externe", true], ["president", true], ["cm_sportvision", true], ["coach", false]]) {
    const j = P[qui].jeton;
    const tel = await rpc(j, "club_membres_coordonnees", { p_club_id: c });
    const voitTel = Array.isArray(tel.data) && tel.data.some((x) => x.membre_id === d.ligneCible.id && x.telephone === TEMOIN.tel);
    t(`[point 1] [${qui}] ${lit ? "lit" : "ne lit pas"} le téléphone d'un autre membre (annuaire)`, voitTel === lit, resume(tel));
    const sp = await comme(j, `club_sponsors?select=id,name,montant&id=eq.${d.sponsor.id}`);
    const voitSp = Array.isArray(sp.data) && sp.data.some((x) => x.name === TEMOIN.sponsor && Number(x.montant) === TEMOIN.montant);
    t(`[point 1] [${qui}] ${lit ? "lit" : "ne lit pas"} le sponsor et son montant`, voitSp === lit, resume(sp));
    const op = await comme(j, `sponsor_operations?select=label&id=eq.${d.operation.id}`);
    const voitOp = Array.isArray(op.data) && op.data.some((x) => x.label === TEMOIN.operation);
    t(`[point 1] [${qui}] ${lit ? "lit" : "ne lit pas"} les opérations du sponsor`, voitOp === lit, resume(op));
  }
  for (const qui of ["cm_externe", "cm_sportvision"]) {
    const f = await rpc(P[qui].jeton, "club_donnees_restreintes", { p_club_id: c });
    t(`[point 1] [${qui}] ne reçoit ni SIRET ni Stripe (aucune ligne)`, f.status === 200 && Array.isArray(f.data) && f.data.length === 0, resume(f));
    const col = await comme(P[qui].jeton, `clubs?select=siret&id=eq.${c}`);
    t(`[point 1] [${qui}] la colonne clubs.siret lui reste fermée`, col.status === 401 || col.status === 403, resume(col));
  }

  // Point 2 — club_calendrier selon le rôle.
  console.log("\n  Point 2 — club_calendrier");
  const du = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const au = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const cal = {};
  for (const qui of ["president", "secretaire", "comm", "cm_externe", "cm_sportvision", "coach", "directeur_sportif", "joueur"]) {
    const r = await rpc(P[qui].jeton, "club_calendrier", { p_club_id: c, p_du: du, p_au: au });
    const lignes = Array.isArray(r.data) ? r.data : [];
    cal[qui] = {
      status: r.status, n: lignes.length,
      autre: lignes.filter((l) => l.team_id === autre.id).length,
      voitClub: lignes.some((l) => l.ref === `evenement:${d.evtClub.id}`),
      voitAutre: lignes.some((l) => l.ref === `evenement:${d.evtAutre.id}`),
    };
  }
  const tout = cal.president.n;
  t("[point 2] vitalité : le Président reçoit le calendrier, avec l'événement de la seconde équipe et celui du club",
    cal.president.status === 200 && tout > 0 && cal.president.voitAutre && cal.president.voitClub, JSON.stringify(cal.president));
  for (const qui of ["secretaire", "comm", "cm_externe", "cm_sportvision", "joueur"]) {
    t(`[point 2] [${qui}] reçoit tout le calendrier du club (${tout} événements)`, cal[qui].status === 200 && cal[qui].n === tout && cal[qui].voitAutre, JSON.stringify(cal[qui]));
  }
  for (const qui of ["coach", "directeur_sportif"]) {
    t(`[point 2] [${qui}] ne reçoit rien de la seconde équipe`, cal[qui].status === 200 && cal[qui].autre === 0 && !cal[qui].voitAutre, JSON.stringify(cal[qui]));
    t(`[point 2] [${qui}] reçoit son équipe et l'événement du club sans équipe`, cal[qui].n > 1 && cal[qui].voitClub && cal[qui].n < tout, JSON.stringify(cal[qui]));
  }
  // La fiche d'équipe (equipe_apercu appelle club_calendrier) : même prochain entraînement pour
  // le coach que pour le Président.
  const ap = async (qui) => { const r = await rpc(P[qui].jeton, "equipe_apercu", { p_team_id: d.equipe.id }); return r.status === 200 ? JSON.stringify([r.data?.prochain_evenement, r.data?.prochain_entrainement]) : `refus ${r.status}`; };
  const apCoach = await ap("coach"), apPres = await ap("president");
  t("[point 2] fiche d'équipe : le coach lit le même prochain événement et entraînement que le Président", apCoach === apPres && !apCoach.startsWith("refus"), `coach=${apCoach.slice(0, 120)} président=${apPres.slice(0, 120)}`);

  // Point 3 — la requête exacte de getClubPlusAccess (app-connect/src/lib/supabase/session.ts).
  console.log("\n  Point 3 — « Mes espaces » (requête de getClubPlusAccess)");
  const acces = (qui) => comme(P[qui].jeton, `club_members?select=role,club_id,clubs(nom)&user_id=eq.${P[qui].id}&status=eq.actif&limit=1`);
  for (const [qui, attendu] of [["joueur", false], ["parent", false], ["coach_connect", true]]) {
    const r = await acces(qui);
    const a = r.status === 200 && Array.isArray(r.data) && r.data.length === 1 && r.data[0]?.clubs?.nom === CLUB_NOM;
    t(`[point 3] [${qui}] ${attendu ? "a" : "n'a pas"} d'accès Club+ (donc ${attendu ? "un" : "aucun"} lien « Mes espaces »)`, a === attendu, resume(r));
  }

  // Point 4 — connect-player-prestations depuis l'origine de Connect.
  console.log("\n  Point 4 — connect-player-prestations (CORS)");
  const FN = `${SB}/functions/v1/connect-player-prestations`;
  const ENTETES = "authorization,apikey,content-type,x-client-info";
  const pre = await fetch(FN, { method: "OPTIONS", headers: { Origin: ORIGINE_CONNECT, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": ENTETES } });
  const allowO = pre.headers.get("access-control-allow-origin") || "";
  const allowH = (pre.headers.get("access-control-allow-headers") || "").toLowerCase();
  t("[point 4] préflight : 2xx, origine autorisée, les 4 en-têtes envoyés par supabase-js autorisés",
    pre.ok && (allowO === "*" || allowO === ORIGINE_CONNECT) && ENTETES.split(",").every((h) => allowH.includes(h)),
    `HTTP ${pre.status}, allow-origin=${allowO}, allow-headers=${allowH}`);
  // Le marqueur de migration-blocages-review-4 ne se pose pas depuis l'API : set_config n'est pas
  // une fonction exposée par PostgREST (seul le schéma public l'est).
  const marqueur = await rpc(P.joueur.jeton, "set_config", { setting_name: "sv.ecriture_systeme", new_value: "client_joueur", is_local: true });
  t("[point 4] le marqueur sv.ecriture_systeme ne peut pas être posé par l'API (set_config introuvable)", marqueur.status === 404, `HTTP ${marqueur.status} ${JSON.stringify(marqueur.data).slice(0, 120)}`);
  const appel = async (qui, body) => {
    const r = await fetch(FN, { method: "POST", headers: { Origin: ORIGINE_CONNECT, apikey: ANON, Authorization: `Bearer ${P[qui].jeton}`, "Content-Type": "application/json", "x-client-info": "supabase-js-web/2" }, body: JSON.stringify(body) });
    return { status: r.status, origine: r.headers.get("access-control-allow-origin"), corps: (await r.text()).slice(0, 140) };
  };
  for (const [qui, body, cle] of [
    ["joueur", { action: "list_orders" }, "orders"], ["joueur", { action: "list_invoices" }, "invoices"], ["joueur", { action: "list_payments" }, "payments"],
    ["parent", { action: "list_orders", multi: true }, "orders"], ["parent", { action: "list_invoices", multi: true }, "invoices"],
  ]) {
    const r = await appel(qui, body);
    t(`[point 4] [${qui}] ${body.action}${body.multi ? " (multi)" : ""} : 200, en-tête CORS présent`, r.status === 200 && !!r.origine && r.corps.includes(`"${cle}"`), `HTTP ${r.status} allow-origin=${r.origine} ${r.corps}`);
  }

  // Point 5 — chronométrage des requêtes des widgets par le chemin réel.
  console.log("\n  Point 5 — durée des requêtes des widgets (PostgREST, vrai jeton)");
  const client = (await lire(`clubs?select=portail_client_id&id=eq.${c}`))[0]?.portail_client_id;
  const REQUETES = [
    ["actualités", `club_newsroom_items?select=id,team,type,title,status&club_id=eq.${c}`],
    ["créations à valider", `club_creations?select=id,title,team&club_id=eq.${c}&status=eq.a_valider`],
    ["matchs", `club_matches?select=id,team,opponent,match_date,status&club_id=eq.${c}`],
    ["demandes de visuels", `club_requests?select=id,team,type,status&club_id=eq.${c}&order=created_at.desc`],
    ["demandes d'adhésion", `membership_requests?select=id,statut,club_teams(name),player_profiles(prenom,nom)&club_id=eq.${c}`],
    ["équipes", `club_teams?select=id,name,categorie&club_id=eq.${c}&or=(archivee.is.null,archivee.is.false)`],
    ["contenus", `contenus?select=id,titre,statut&client_id=eq.${client}`],
  ];
  for (const qui of ["president", "coach", "secretaire", "comm", "cm_externe", "directeur_sportif", "cm_sportvision"]) {
    const mesures = [];
    let pire = 0, erreur = null;
    for (const [nom, chemin] of REQUETES) {
      const r = await comme(P[qui].jeton, chemin);
      if (r.status >= 400) erreur = `${nom} : ${resume(r)}`;
      pire = Math.max(pire, r.ms);
      mesures.push(`${nom} ${r.ms} ms`);
    }
    t(`[point 5] [${qui}] aucune requête des widgets en erreur ni au-delà de 2 s (pire : ${pire} ms)`, !erreur && pire < 2000, erreur || mesures.join(", "));
  }
}

// ── 2. ÉCRANS ────────────────────────────────────────────────────────────────────────────────
const bruit = (l) => l.filter((e) => !/favicon|Download the React DevTools|ResizeObserver loop|status of 40[34]/i.test(e));
const texteDe = async (page) => ((await page.evaluate(() => document.body?.innerText || "")) || "").replace(/\s+/g, " ");

async function mesurerEcrans(d) {
  const { chromium } = await import("../../SportVision-Connect/app-next/node_modules/playwright/index.mjs");
  const nav = await chromium.launch();
  const { P } = d;
  try {
    // Connect.
    console.log(`\nÉCRANS — Connect (${CX})`);
    const connecterConnect = async (qui) => {
      const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
      const page = await ctx.newPage();
      const erreurs = [];
      const fonctions = [];
      page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
      page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
      page.on("response", (r) => { if (r.url().includes("/functions/v1/connect-player-prestations")) fonctions.push(`${r.request().method()} ${r.status()}`); });
      await page.goto(`${CX}/auth/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      await page.locator("input[type=email]").first().fill(P[qui].email);
      await page.locator("input[type=password]").first().fill(MDP);
      await page.locator("button", { hasText: /Se connecter/ }).first().click();
      await page.waitForTimeout(8000);
      return { ctx, page, erreurs, fonctions };
    };
    const aller = async (page, chemin) => {
      await page.goto(`${CX}${chemin}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
      return texteDe(page);
    };

    {
      const { ctx, page, erreurs, fonctions } = await connecterConnect("joueur");
      const profil = await aller(page, "/profil");
      t("[point 3] [joueur] Mon profil s'affiche", /Mon profil|Informations personnelles/i.test(profil), profil.slice(0, 160));
      t("[point 3] [joueur] aucun bloc « Mes espaces » (pas de rôle dans Club+)", !/Mes espaces/.test(profil), "");
      for (const [chemin, libelle] of [["/commandes", "Mes commandes"], ["/factures", "Factures & paiements"]]) {
        fonctions.length = 0;
        const texte = await aller(page, chemin);
        t(`[point 4] [joueur] ${libelle} se charge (fonction appelée, 200)`, fonctions.length > 0 && fonctions.every((f) => /^(POST|OPTIONS) 20\d$/.test(f)) && !/Impossible de charger/i.test(texte), `${fonctions.join(", ")} — ${texte.slice(0, 120)}`);
      }
      const cors = erreurs.filter((e) => /CORS|Access-Control/i.test(e));
      t("[point 4] [joueur] aucune erreur CORS dans la console", cors.length === 0, cors.slice(0, 2).join(" · "));
      await ctx.close();
    }
    {
      const { ctx, page, erreurs, fonctions } = await connecterConnect("parent");
      for (const [chemin, libelle] of [["/particulier/commandes", "commandes"], ["/particulier/factures", "factures"]]) {
        fonctions.length = 0;
        const texte = await aller(page, chemin);
        t(`[point 4] [parent] ${libelle} des sportifs se chargent (fonction appelée, 200)`, fonctions.length > 0 && fonctions.every((f) => /^(POST|OPTIONS) 20\d$/.test(f)) && !/Impossible de charger/i.test(texte), `${fonctions.join(", ")} — ${texte.slice(0, 120)}`);
      }
      const texte = await aller(page, "/particulier");
      t("[point 3] [parent] aucun lien vers Club+ dans son espace", !/Mes espaces|clubplus\.sportvision-an\.fr/.test(texte + (await page.content())), "");
      const cors = erreurs.filter((e) => /CORS|Access-Control/i.test(e));
      t("[point 4] [parent] aucune erreur CORS dans la console", cors.length === 0, cors.slice(0, 2).join(" · "));
      await ctx.close();
    }
    {
      const { ctx, page } = await connecterConnect("coach_connect");
      const profil = await aller(page, "/profil");
      const lien = await page.locator('a[href*="clubplus.sportvision-an.fr"]').count();
      t("[point 3] [coach avec compte Connect] « Mes espaces » montre Villeneuve 340 SC et un lien vers Club+ (contrôle positif)",
        /Mes espaces/.test(profil) && profil.includes(CLUB_NOM) && lien > 0, profil.slice(0, 160));
      await ctx.close();
    }

    // Club+ : ce que la page Calendrier reçoit vraiment du réseau.
    console.log(`\nÉCRANS — Club+ (${CP})`);
    for (const qui of ["coach", "president"]) {
      const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
      const page = await ctx.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
      page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
      const recus = [];
      page.on("response", async (r) => {
        if (r.url().includes("/rest/v1/rpc/club_calendrier")) { try { recus.push(...(await r.json())); } catch { /* réponse non JSON */ } }
      });
      await page.goto(`${CP}/clubplus/auth/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      await page.locator("input[type=email]").first().fill(P[qui].email);
      await page.locator("input[type=password]").first().fill(MDP);
      await page.locator("button", { hasText: "Se connecter" }).first().click();
      await page.waitForSelector("aside nav a", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.goto(`${CP}/clubplus/calendar`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(4000);
      const autre = recus.filter((l) => l.team_id === d.autre.id).length;
      if (qui === "coach") {
        t("[point 2] [coach] page Calendrier : la réponse réseau ne contient rien de la seconde équipe", recus.length > 0 && autre === 0, `${recus.length} événements reçus, ${autre} de la seconde équipe`);
        t("[point 2] [coach] page Calendrier : l'événement du club sans équipe est reçu", recus.some((l) => l.ref === `evenement:${d.evtClub.id}`), `${recus.length} événements reçus`);
      } else {
        t("[point 2] [president] page Calendrier : reçoit aussi la seconde équipe (contrôle positif)", autre > 0 && recus.some((l) => l.ref === `evenement:${d.evtAutre.id}`), `${recus.length} événements reçus, ${autre} de la seconde équipe`);
      }
      t(`[point 2] [${qui}] page Calendrier sans erreur JavaScript ni écran d'erreur`, bruit(erreurs).length === 0 && !/Impossible de charger le calendrier/.test(await texteDe(page)), bruit(erreurs).slice(0, 3).join(" · "));
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
  if (club) {
    await del(`club_sponsors?club_id=eq.${club}&name=eq.${encodeURIComponent(TEMOIN.sponsor)}`);
    await del(`club_calendar_events?club_id=eq.${club}&title=like.ZZ*${T0}`);
  }
  for (const id of traces.comptes) {
    const par = (await lire(`parent_profiles?select=id&user_id=eq.${id}`))[0];
    if (par) { await del(`parent_player_relationships?parent_id=eq.${par.id}`); await del(`parent_profiles?id=eq.${par.id}`); }
    for (const pl of await lire(`player_profiles?select=id&user_id=eq.${id}`)) {
      await del(`team_memberships?player_id=eq.${pl.id}`);
      await del(`membership_requests?player_id=eq.${pl.id}`);
      await del(`player_profiles?id=eq.${pl.id}`);
    }
    await del(`club_cm_affectations?cm_id=eq.${id}`);
    await del(`club_members?user_id=eq.${id}`);
    await del(`connect_profile_settings?user_id=eq.${id}`);
    await del(`notifications?destinataire_id=eq.${id}`);
    await del(`member_notifications?user_id=eq.${id}`);
    if (club) await del(`club_onboarding_events?club_id=eq.${club}&auteur_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  }
  if (club) await del(`club_onboarding_events?club_id=eq.${club}&created_at=gte.${new Date(T0).toISOString()}`);

  const restes = [];
  for (const id of traces.comptes) {
    const u = await (await auth(`admin/users/${id}`)).json().catch(() => ({}));
    if (u?.id) restes.push(`compte ${u.email}`);
    for (const tb of ["club_members?user_id", "profiles?id", "player_profiles?user_id", "parent_profiles?user_id", "club_cm_affectations?cm_id", "connect_profile_settings?user_id", "member_notifications?user_id"]) {
      if ((await lire(`${tb}=eq.${id}&select=*`)).length) restes.push(`${tb.split("?")[0]} ${id}`);
    }
  }
  if (club) {
    if ((await lire(`club_sponsors?select=id&club_id=eq.${club}&name=like.ZZ*`)).length) restes.push("sponsor ZZ");
    if ((await lire(`club_calendar_events?select=id&club_id=eq.${club}&title=like.ZZ*${T0}`)).length) restes.push("événements ZZ");
    if ((await lire(`club_onboarding_events?select=id&club_id=eq.${club}&created_at=gte.${new Date(T0).toISOString()}`)).length) restes.push("journal du club");
    // Le client que connect-player-prestations crée à la demande pour le joueur de test
    // (find_or_create_client_by_email), avec son message de bienvenue et l'organisation « projet »
    // que le déclencheur sync_client_to_organization lui associe (même identifiant).
    for (const cl of await lire(`clients?select=id&email=like.zz-blocages-*${T0}*`)) {
      await del(`messages_client?client_id=eq.${cl.id}`);
      await del(`organizations?id=eq.${cl.id}&organization_type=eq.projet`);
      await del(`clients?id=eq.${cl.id}`);
      if ((await lire(`clients?select=id&id=eq.${cl.id}`)).length) restes.push(`client ${cl.id}`);
      if ((await lire(`organizations?select=id&id=eq.${cl.id}`)).length) restes.push(`organisation ${cl.id}`);
    }
  }
  t("nettoyage : aucune trace (comptes, rattachements, famille, CM, sponsor, événements, clients, journal)", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
}

let decor = null;
try {
  if (doit("SQL")) {
    await jouerSql("blocages-review.test.sql", "SQL — points 1, 2 et équivalence du point 5, en transaction annulée");
    await jouerSql("blocages-review-client-joueur.test.sql", "SQL — point 4, premier rattachement d'une fiche joueur à son client");
  }
  if (doit("PERF")) await jouerSql("blocages-review-perf.test.sql", "PERF — point 5, coût par rôle avant/après");
  if (doit("DONNEES") || doit("ECRANS")) {
    decor = await preparer();
    if (doit("DONNEES")) await mesurerDonnees(decor);
    if (doit("ECRANS")) await mesurerEcrans(decor);
  }
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.stack || e).split("\n").slice(0, 3).join(" · "));
} finally {
  // Une coupure réseau pendant le nettoyage (constatée le 11/09/2026 : ENOTFOUND) ne doit pas
  // passer inaperçue : le test le dit et donne les comptes à retrouver.
  if (decor || traces.comptes.length) {
    try {
      await nettoyer(decor);
    } catch (e) {
      t("nettoyage : aucune trace", false, `NETTOYAGE INTERROMPU (${String(e?.cause?.code || e).slice(0, 60)}) : supprimer les comptes zz-blocages-*-${T0}@example.invalid et leurs lignes`);
    }
  }
}
process.exit(bilan() ? 1 : 0);
