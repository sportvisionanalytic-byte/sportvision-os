// L'espace du CM dans l'OS et le SIRET des fiches clients, par le chemin réel (11/09/2026).
//
//   1. SIRET d'une fiche client (`clients.siret`) : décision de Fouka, jamais le CM. Ceux qui en
//      ont l'usage le lisent par rpc/client_siret (migration-os-cm-siret-client-1/-2).
//   2. Blocage n° 2 de l'audit Review : l'espace d'un CM affilié est vide. L'audit l'attribuait à
//      `profiles.niveau_cm` nul ; mesuré ici, le palier nul n'y est pour rien, la cause est la
//      condition de pôle des policies clients/contrats (migration-os-cm-perimetre-clients).
//
// POURQUOI CE TEST, EN PLUS DU TEST SQL. tests/os-cm-espace-et-siret.test.sql prouve les
// migrations AVANT leur exécution, en transaction annulée. Celui-ci prouve, APRÈS, que la base de
// production répond bien ainsi à de vrais jetons (PostgREST), et que l'OS modifié tient dans un
// vrai navigateur. L'API Management s'exécute en postgres : elle ne prouve rien sur des droits.
// Il est ROUGE tant que les migrations ne sont pas exécutées : c'est la preuve qu'elles ont pris.
//
//   node livrables/SportVision-TV/tests/os-cm-espace-et-siret.test.mjs
//   SEULEMENT=STATIQUE node …    (lecture du fichier OS seulement, aucun réseau)
//   SEULEMENT=DONNEES node …     (PostgREST seulement)
//   SEULEMENT=ECRANS node …      (navigateur ; l'OS du dépôt est servi à la place de l'OS en ligne)
//   OS_EN_LIGNE=1 …              (ECRANS sur l'OS déployé, sans substitution)
//
// PROPRETÉ. Comptes de test de Fouka pour les rôles qui en ont un (« chris fouka », CM au palier
// nul, pôle Football, CM secondaire de Villeneuve 340 SC ; « christian fouka », Resp. Production ;
// « c fka », opérateur). Un seul compte fabriqué, faute de compte de test sans pôle :
// zz-os-cm-sanspole-<T0>@example.invalid (API d'administration, aucun e-mail). SIRET témoin posé
// sur la fiche client du club de test « Villeneuve 340 SC » le temps du test, puis l'état
// d'origine est rétabli. Tout est supprimé à la fin, et la suppression est vérifiée.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { compte, jeton, rapporteur, SB, ANON, OS, enTeteAdmin } from "./_session-os.mjs";

const SEULEMENT = (process.env.SEULEMENT || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const doit = (partie) => SEULEMENT.length === 0 || SEULEMENT.includes(partie);
const CLUB_NOM = "Villeneuve 340 SC";
const T0 = Date.now();
const MDP = `ZzOsCm!${T0}`;
const TEMOIN = `999 ${String(T0).slice(-11, -8)} ${String(T0).slice(-8, -5)} ${String(T0).slice(-5)}`;
const Z = "00000000-0000-0000-0000-000000000000";
// OS_FICHIER=<chemin> : relire une autre version du fichier (ex. celle d'avant le correctif).
const cheminOS = process.env.OS_FICHIER || new URL("../SportVision-OS-Full.html", import.meta.url).pathname;
const { t, bilan } = rapporteur();

// ── 0. Le fichier OS ne demande jamais `*` ni `siret` sur `clients` ─────────────────────────
// Après migration-os-cm-siret-client-2, PostgREST fait échouer ces requêtes ENTIÈREMENT (42501),
// pour tous les rôles. Vérifié sur la source, parce que les écrans qui les portent (devis,
// factures, avoirs, contrats de l'Admin SportVision) n'ont pas de compte de test.
if (doit("STATIQUE")) {
  console.log("\n0. Le fichier OS, relu");
  const html = readFileSync(cheminOS, "utf8");
  const code = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  // `(?<![a-z_])` : `avis_clients` est une autre table.
  const etoile = [...code.matchAll(/(?<![a-z_])clients(![a-z_]+)?\(\s*\*\s*\)/g)].length
    + [...code.matchAll(/(?<![a-z_])clients\?[^'"`]*select=\*/g)].length;
  t("aucune jointure ni lecture `*` sur clients", etoile === 0, `${etoile} occurrence(s)`);
  t("aucune mention de siret sur clients côté code (hors identité SportVision et doublons de clubs)",
    !/clients\?[^'"`]*siret|clients\([^)]*siret/.test(code));
  const ecritures = [...code.matchAll(/sbFetch\((['"`])(clients(?:\?[^'"`]*)?)\1(?:\+[^,]+)?,\{method:'(POST|PATCH)'/g)];
  const sansListe = ecritures.filter((m) => !/select=/.test(m[0]));
  t(`chaque écriture sur clients demande un retour limité (select=…) — ${ecritures.length} écritures`,
    ecritures.length >= 10 && sansListe.length === 0, sansListe.map((m) => m[0].slice(0, 90)).join(" | "));
  const liste = (code.match(/const CLIENTS_COLONNES='([^']+)'/) || [])[1] || "";
  t("CLIENTS_COLONNES ne contient pas siret", liste && !liste.split(",").includes("siret"), liste.slice(0, 80));
}

// ── Accès service : décor et nettoyage uniquement, jamais pour une mesure de droits ──────────
const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, {
    ...opts,
    headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) },
  });
const lire = async (chemin) => { const r = await api(chemin); return r.ok ? r.json() : []; };
const ecrire = async (chemin, method, body) => {
  const r = await api(chemin, { method, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${chemin.split("?")[0]} : ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? [] : r.json();
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

// ── Le chemin réel : PostgREST avec le jeton de la personne ──
async function comme(jeton, chemin, { method = "GET", body, prefer = "return=representation" } = {}) {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texte = await r.text();
  let data = null;
  try { data = JSON.parse(texte); } catch { data = texte; }
  return { status: r.status, data };
}
const resume = (r) => (r.status >= 400 ? `refus ${r.status} ${r.data?.code || ""}` : JSON.stringify(r.data).slice(0, 110));
const contientTemoin = (r) => JSON.stringify(r.data ?? "").includes(TEMOIN);

const traces = { comptes: new Set(), client: null, siretOrigine: undefined, club: null };

async function creerCmSansPole() {
  const email = `zz-os-cm-sanspole-${T0}@example.invalid`;
  const d = await (await auth("admin/users", { method: "POST", body: JSON.stringify({ email, password: MDP, email_confirm: true }) })).json();
  if (!d.id) throw new Error(`création du compte impossible : ${JSON.stringify(d).slice(0, 160)}`);
  traces.comptes.add(d.id);
  // Palier nul, AUCUNE affectation de pôle : le cas de Camille dans Review.
  const profil = { role: "cm", prenom: "ZZ", nom: "OS CM sans pôle", email, actif: true, niveau_cm: null };
  if ((await lire(`profiles?select=id&id=eq.${d.id}`)).length) await ecrire(`profiles?id=eq.${d.id}`, "PATCH", profil);
  else await ecrire("profiles", "POST", { id: d.id, ...profil });
  await api(`pole_affectations?user_id=eq.${d.id}`, { method: "DELETE" });
  await ecrire("club_cm_affectations", "POST", { club_id: traces.club, cm_id: d.id, role: "secondaire", actif: true });
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: MDP }),
  });
  const acces = (await r.json()).access_token;
  if (!acces) throw new Error("aucun jeton pour le CM sans pôle");
  return { id: d.id, email, prenom: "ZZ", nom: "OS CM sans pôle", role: "cm", acces };
}

async function nettoyer() {
  const del = (chemin) => api(chemin, { method: "DELETE" });
  if (traces.client && traces.siretOrigine !== undefined) {
    await api(`clients?id=eq.${traces.client}`, { method: "PATCH", body: JSON.stringify({ siret: traces.siretOrigine }) });
  }
  for (const id of traces.comptes) {
    await del(`club_cm_affectations?cm_id=eq.${id}`);
    await del(`pole_affectations?user_id=eq.${id}`);
    await del(`notifications?destinataire_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  }
  const restes = [];
  for (const id of traces.comptes) {
    const u = await (await auth(`admin/users/${id}`)).json().catch(() => ({}));
    if (u?.id) restes.push(`compte ${u.email}`);
    for (const tb of ["profiles?id", "club_cm_affectations?cm_id", "pole_affectations?user_id"]) {
      if ((await lire(`${tb}=eq.${id}&select=*`)).length) restes.push(`${tb.split("?")[0]} ${id}`);
    }
  }
  if (traces.client && traces.siretOrigine !== undefined) {
    const c = (await lire(`clients?select=siret&id=eq.${traces.client}`))[0] || {};
    if ((c.siret ?? null) !== (traces.siretOrigine ?? null)) restes.push("clients.siret non rétabli");
  }
  t("nettoyage : aucune trace (compte, profil, affectations, SIRET témoin)", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
}

let cmSansPole = null;
let chris = null, christian = null, cfka = null;
try {
  if (doit("DONNEES") || doit("ECRANS")) {
    const club = (await lire(`clubs?select=id,nom,portail_client_id&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
    if (!club?.portail_client_id) throw new Error(`club ${CLUB_NOM} ou sa fiche client introuvable`);
    traces.club = club.id;
    traces.client = club.portail_client_id;
    const autre = (await lire(`clubs?select=portail_client_id,nom&nom=neq.${encodeURIComponent(CLUB_NOM)}&portail_client_id=not.is.null&order=nom&limit=1`))[0];
    traces.clientAutre = autre?.portail_client_id;
    traces.siretOrigine = ((await lire(`clients?select=siret&id=eq.${traces.client}`))[0] || {}).siret ?? null;
    await ecrire(`clients?id=eq.${traces.client}&select=id`, "PATCH", { siret: TEMOIN });

    chris = await compte("role=eq.cm&prenom=eq.chris&nom=eq.fouka");
    christian = await compte("role=eq.prod&prenom=eq.christian&nom=eq.fouka");
    cfka = await compte("role=eq.photo&prenom=eq.c&nom=eq.fka");
    for (const p of [chris, christian, cfka]) if (p) p.acces = (await jeton(p.email))?.acces;
    cmSansPole = await creerCmSansPole();
  }

  // ── 1. SIRET, par PostgREST ────────────────────────────────────────────────────────────────
  if (doit("DONNEES")) {
    console.log("\n1. Le SIRET d'une fiche client (témoin posé sur « Villeneuve 340 SC »)");
    const C = traces.client;
    // CLIENTS_COLONNES (OS) doit valoir « toutes les colonnes sauf siret » : une colonne en trop
    // ferait échouer les devis/factures, une en moins les priverait d'une donnée.
    const liste = ((readFileSync(cheminOS, "utf8").match(/const CLIENTS_COLONNES='([^']+)'/) || [])[1] || "").split(",").sort();
    const reelles = Object.keys((await lire(`clients?select=*&id=eq.${C}`))[0] || {}).filter((k) => k !== "siret").sort();
    t("CLIENTS_COLONNES = toutes les colonnes de clients sauf siret (base de production)",
      reelles.length > 0 && JSON.stringify(liste) === JSON.stringify(reelles),
      `en trop : ${liste.filter((k) => !reelles.includes(k)).join(",") || "—"} ; manquantes : ${reelles.filter((k) => !liste.includes(k)).join(",") || "—"}`);
    const vit = await comme(chris.acces, `clients?select=id,nom&id=eq.${C}`);
    t("vitalité : le CM (chris fouka) voit la fiche du client de son club", Array.isArray(vit.data) && vit.data.length === 1, resume(vit));
    for (const [lib, chemin] of [
      ["clients?select=siret", `clients?select=siret&id=eq.${C}`],
      ["clients?select=*", `clients?select=*&id=eq.${C}`],
      ["contrats?select=clients(*)", `contrats?select=id,clients(*)&client_id=eq.${C}`],
    ]) {
      const r = await comme(chris.acces, chemin);
      t(`le CM ne lit pas le SIRET par ${lib}`, !contientTemoin(r), resume(r));
    }
    const fn = await comme(chris.acces, "rpc/client_siret", { method: "POST", body: { p_client_id: C } });
    t("le CM ne lit pas le SIRET par rpc/client_siret", !contientTemoin(fn), resume(fn));
    const fnSP = await comme(cmSansPole.acces, "rpc/client_siret", { method: "POST", body: { p_client_id: C } });
    t("le CM sans pôle ne le lit pas non plus par rpc/client_siret", !contientTemoin(fnSP), resume(fnSP));

    // Contrôle positif : sans lui, chaque « ne lit pas » pourrait venir d'une fonction absente.
    const prod = await comme(christian.acces, "rpc/client_siret", { method: "POST", body: { p_client_id: C } });
    t("le Responsable Production (christian fouka, pôle Football) lit le SIRET par rpc/client_siret", contientTemoin(prod), resume(prod));
    const prodTable = await comme(christian.acces, `clients?select=siret&id=eq.${C}`);
    t("… mais plus par la table : la colonne est fermée à tous les comptes", prodTable.status === 403, resume(prodTable));
    const photo = await comme(cfka.acces, "rpc/client_siret", { method: "POST", body: { p_client_id: C } });
    t("l'opérateur (c fka) ne lit pas le SIRET", !contientTemoin(photo), resume(photo));

    // Le piège de la fermeture, mesuré sans toucher une ligne (identifiant qui n'existe pas) :
    // un PATCH qui renvoie la ligne sans liste de colonnes échoue, avec select=id il passe.
    const sansListe = await comme(christian.acces, `clients?id=eq.${Z}`, { method: "PATCH", body: { notes: "zz" } });
    t("un PATCH clients sans liste de colonnes est refusé (preuve que la colonne est fermée)", sansListe.status === 403, resume(sansListe));
    const avecListe = await comme(christian.acces, `clients?id=eq.${Z}&select=id`, { method: "PATCH", body: { notes: "zz" } });
    t("un PATCH clients avec select=id répond (l'écriture de l'OS reste possible)", avecListe.status === 200, resume(avecListe));
    // Les quatre requêtes de documents (contrat, avoir, devis, facture), telles que l'OS les
    // construit. PostgREST valide chaque colonne même sans ligne : une faute dans la liste, ou
    // siret, répondrait 400 ou 403.
    for (const [tb, suite] of [["contrats", ""], ["avoirs", ",prestation:prestations(reference,date_prestation)"],
      ["devis", ",prestation:prestations(id,reference,date_prestation,lieu,description_besoin,livrables_demandes)"],
      ["prestations", ",devis(id,numero,statut,total_ht,total_ttc,tva_pct,lignes,remise_pct,remise_montant)"]]) {
      const r = await comme(christian.acces, `${tb}?id=eq.${Z}&select=*,clients(${liste.join(",")})${suite}`);
      t(`la requête de document « ${tb} » de l'OS répond`, r.status === 200, resume(r));
    }

    // ── 2. L'espace du CM au palier nul ──────────────────────────────────────────────────────
    console.log("\n2. L'espace d'un CM au palier nul");
    // Mesure, hors comptes fabriqués par les tests (prénom « ZZ »).
    const nuls = await lire("profiles?select=prenom,nom,actif&role=eq.cm&niveau_cm=is.null&prenom=neq.ZZ");
    const tous = await lire("profiles?select=id&role=eq.cm&prenom=neq.ZZ");
    console.log(`  mesure : ${nuls.length} profil(s) CM au palier nul sur ${tous.length} : ${nuls.map((p) => `${p.prenom} ${p.nom}${p.actif ? "" : " (inactif)"}`).join(", ") || "aucun"}`);

    const COLS = "id,nom,statut,type_client,sport,ville,email,telephone,prenom_contact,nom_contact";
    const chrisCl = await comme(chris.acces, `clients?select=${COLS}&order=nom.asc&limit=200`);
    t("CM au palier nul AVEC pôle (chris fouka) : « Mes structures » contient le club de test — le palier nul n'y est pour rien",
      Array.isArray(chrisCl.data) && chrisCl.data.some((c) => c.id === C), resume(chrisCl));
    const autorises = await comme(cmSansPole.acces, "rpc/cm_clubs_autorises", { method: "POST", body: {} });
    t("vitalité : cm_clubs_autorises() confie le club au CM sans pôle",
      JSON.stringify(autorises.data).includes(traces.club), resume(autorises));
    const spCl = await comme(cmSansPole.acces, `clients?select=${COLS}&order=nom.asc&limit=200`);
    t("CM au palier nul SANS pôle : « Mes structures » contient le club confié",
      Array.isArray(spCl.data) && spCl.data.some((c) => c.id === C), resume(spCl));
    const spK = await comme(cmSansPole.acces, "contrats?select=client_id,clients(id,nom)&type_contrat=eq.full_communication&statut=eq.actif");
    t("CM au palier nul SANS pôle : « Planning » contient le contrat Full Communication du club",
      Array.isArray(spK.data) && spK.data.some((k) => k.client_id === C && k.clients?.nom), resume(spK));
    if (traces.clientAutre) {
      const front = await comme(cmSansPole.acces, `clients?select=id&id=eq.${traces.clientAutre}`);
      t("frontière : le CM sans pôle ne voit pas la fiche d'un club qui ne lui est pas confié",
        Array.isArray(front.data) && front.data.length === 0, resume(front));
    }
  }

  // ── 3. Les écrans, dans un vrai navigateur ─────────────────────────────────────────────────
  if (doit("ECRANS")) {
    console.log(`\n3. Les écrans du CM (${process.env.OS_EN_LIGNE === "1" ? "OS en ligne" : "OS du dépôt, servi à la place de l'OS en ligne"})`);
    const html = readFileSync(cheminOS, "utf8");
    const navigateur = await chromium.launch();
    const ouvrir = async (p) => {
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await contexte.newPage();
      if (process.env.OS_EN_LIGNE !== "1") {
        await page.route(/sportvision-an\.fr\/(SportVision-OS-Full\.html|sportvision-os-full)(\?.*)?$/i,
          (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      }
      const fautes = [];
      const requetesClients = [];
      page.on("pageerror", (e) => fautes.push("JS " + String(e).slice(0, 160)));
      page.on("request", (r) => {
        const u = decodeURIComponent(r.url());
        if (/\/rest\/v1\/clients(\?|$)|[,=(]clients\(/.test(u)) requetesClients.push(`${r.method()} ${u.replace(/^.*\/rest\/v1\//, "")}`);
      });
      page.on("response", async (r) => {
        if (r.status() >= 400 && /supabase\.co\/rest/.test(r.url())) {
          let c = ""; try { c = (await r.text()).slice(0, 100); } catch {}
          fautes.push(`HTTP ${r.status()} ${decodeURIComponent(new URL(r.url()).pathname.replace("/rest/v1/", ""))} ${c}`);
        }
      });
      await page.addInitScript((s) => {
        localStorage.setItem("sv_tok", s.tok); localStorage.setItem("sv_ref", "");
        localStorage.setItem("sv_uid", s.uid); localStorage.setItem("sv_role", s.role); localStorage.setItem("sv_prenom", s.prenom);
      }, { tok: p.acces, uid: p.id, role: p.role, prenom: p.prenom || "" });
      await page.goto(OS, { waitUntil: "domcontentloaded" });
      // `S` est un `let` de premier niveau : il n'est pas une propriété de window.
      await page.waitForFunction(() => typeof switchView === "function" && typeof S !== "undefined" && S.role, null, { timeout: 30000 });
      await page.waitForTimeout(4000);
      return { page, fautes, requetesClients, fermer: () => contexte.close() };
    };
    const texteVue = async (page, vue) => {
      await page.evaluate((v) => window.switchView(v), vue);
      await page.waitForTimeout(4500);
      return page.evaluate(() => document.body.innerText);
    };
    const nomClub = CLUB_NOM;

    // a) chris fouka : CM au palier nul, avec pôle. Contrôle : son espace n'est pas vide.
    const a = await ouvrir(chris);
    const accA = await texteVue(a.page, "dash");
    t("CM au palier nul (chris fouka) — Accueil : « Mes clubs » liste le club de test", accA.includes(nomClub));
    const strA = await texteVue(a.page, "clients");
    t("CM au palier nul (chris fouka) — Mes structures : le club de test y est", strA.includes(nomClub));
    const plaA = await texteVue(a.page, "planning");
    t("CM au palier nul (chris fouka) — Planning : le club de test y est", plaA.includes(nomClub));
    t("le SIRET témoin n'apparaît sur aucun de ces écrans", ![accA, strA, plaA].some((x) => x.includes(TEMOIN)));
    const etoileA = a.requetesClients.filter((q) => /clients\?[^ ]*select=\*|clients\(\*\)|siret/.test(q));
    t(`aucune requête de l'OS sur clients ne demande * ni siret (${a.requetesClients.length} requêtes)`, etoileA.length === 0, etoileA.join(" | "));
    t("aucune erreur JavaScript ni réponse 4xx/5xx de Supabase", a.fautes.length === 0, a.fautes.slice(0, 5).join(" | "));
    await a.fermer();

    // b) CM au palier nul SANS pôle : le cas de Camille.
    const b = await ouvrir(cmSansPole);
    const accB = await texteVue(b.page, "dash");
    t("CM sans pôle — Accueil : « Mes clubs » liste le club confié", accB.includes(nomClub));
    const strB = await texteVue(b.page, "clients");
    t("CM sans pôle — Mes structures : le club confié y est", strB.includes(nomClub), strB.includes("Aucune structure") ? "« Aucune structure visible pour l'instant »" : "");
    const plaB = await texteVue(b.page, "planning");
    t("CM sans pôle — Planning : le club confié y est", plaB.includes(nomClub));
    t("aucune erreur JavaScript ni réponse 4xx/5xx de Supabase (CM sans pôle)", b.fautes.length === 0, b.fautes.slice(0, 5).join(" | "));
    await b.fermer();
    await navigateur.close();
  }
} catch (e) {
  t("le test s'exécute", false, String(e?.stack || e).slice(0, 400));
} finally {
  if (doit("DONNEES") || doit("ECRANS")) await nettoyer();
}
process.exit(bilan() ? 1 : 0);
