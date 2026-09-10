// Décisions du 10/09/2026 sur l'OS, rejouées dans un vrai navigateur avec de vrais comptes.
//
//   1. Recrue en intégration : les formations ne bloquent plus l'activation ; seuls les éléments
//      administratifs (statut contractuel, RIB, contrat) la conditionnent.
//   4. Écran mobile (390 px) : RH, expert-comptable et auditeur ne reçoivent plus le tableau de
//      bord mobile de l'Admin ; un Responsable de pôle arrive sur « Mon pôle » comme en desktop.
//   5. Nouvelle version : l'OS revérifie /version.json (5 min, retour sur l'onglet) et affiche un
//      bandeau si le commit a changé — jamais de rechargement automatique ; rien si le fichier
//      est absent ou en erreur.
//
// COMMENT. L'URL de production est ouverte dans Chromium, mais `page.route` sert le fichier du
// dépôt à sa place (SOURCE=local, par défaut) : on teste le code qu'on s'apprête à livrer, sur la
// vraie base. SOURCE=prod laisse passer la version en ligne : c'est le « rouge avant ».
// /version.json est toujours servi par le test, pour maîtriser le commit annoncé.
//
// REGLES. Comptes zz-os-dec-<objet>-<horodatage>@example.invalid créés par l'API admin (lien
// généré, jamais envoyé : aucun e-mail), inscrits sur la liste de suppression d'abord. Aucun vrai
// compte n'est touché. Tout est supprimé à la fin et la suppression est vérifiée.
//
//   node livrables/SportVision-TV/tests/os-decisions-10-09.test.mjs
//   SOURCE=prod node livrables/SportVision-TV/tests/os-decisions-10-09.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { env, SB, KEY, rapporteur } from "./_session-os.mjs";

const SOURCE = process.env.SOURCE === "prod" ? "prod" : "local";
const OS = "https://bc6m3cgdz.sportvision-an.fr/SportVision-OS-Full.html";
const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const RUN = Date.now();
const MOTIF = `zz-os-dec-%-${RUN}@example.invalid`;
const { t, bilan } = rapporteur();
console.log(`OS teste : ${SOURCE === "local" ? "fichier du depot (page.route)" : "version en ligne"}\n`);

async function sql(q) {
  const ref = new URL(SB).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const x = await r.text(); try { return JSON.parse(x); } catch { return x; }
}
async function rest(chemin, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, { ...init, headers: { ...H, Prefer: "return=representation", ...(init.headers || {}) } });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; }
  if (!r.ok) throw new Error(`${chemin} : ${r.status} ${x.slice(0, 200)}`);
  return j;
}

// Un collaborateur créé comme le fait invite-collaborateur (lien d'invitation généré, pas envoyé).
const crees = [];
async function collaborateur(objet, role) {
  const email = `zz-os-dec-${objet}-${RUN}@example.invalid`;
  await rest("communication_suppressions", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ channel: "EMAIL", address: email, reason: "manual" }) });
  const l = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "invite", email, data: { prenom: "Zoé", nom: "Essai " + objet, role } }) })).json();
  if (!l.action_link) throw new Error("invitation impossible : " + JSON.stringify(l).slice(0, 200));
  const id = l.id || l.user?.id;
  crees.push(id);
  const loc = (await fetch(l.action_link, { redirect: "manual" })).headers.get("location") || "";
  const p = new URLSearchParams(loc.split("#")[1] || "");
  return { id, email, role, prenom: "Zoé", acces: p.get("access_token"), rafraichissement: p.get("refresh_token") || "" };
}

let versionServie = { statut: 200, commit: "aaaa111" };
const nav = await chromium.launch();
async function ouvrir(personne, { largeur = 1440, hauteur = 900, avantChargement } = {}) {
  const ctx = await nav.newContext({ viewport: { width: largeur, height: hauteur } });
  if (SOURCE === "local") {
    await ctx.route(/\/SportVision-OS-Full\.html(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  }
  await ctx.route(/\/version\.json(\?.*)?$/, (r) =>
    versionServie.statut === 200
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ commit: versionServie.commit, branche: "main", contexte: "production", date: new Date().toISOString() }) })
      : r.fulfill({ status: versionServie.statut, body: "absent" }));
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on("pageerror", (e) => page.erreurs.push(String(e).split("\n")[0]));
  if (avantChargement) await avantChargement(page);
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("zz_seme")) return; // un rechargement ne resème pas
    sessionStorage.setItem("zz_seme", "1");
    localStorage.setItem("sv_tok", s.tok); localStorage.setItem("sv_ref", s.ref);
    localStorage.setItem("sv_uid", s.uid); localStorage.setItem("sv_role", s.role); localStorage.setItem("sv_prenom", s.prenom);
  }, { tok: personne.acces, ref: personne.rafraichissement, uid: personne.id, role: personne.role, prenom: personne.prenom });
  await page.goto(OS, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return page;
}
const texte = (page, sel = "#app-ct") => page.evaluate((s) => (document.querySelector(s)?.innerText || "").replace(/\s+/g, " "), sel);
const modale = (page) => page.evaluate(() => (document.getElementById("sv-modal-ct")?.innerText || "").replace(/\s+/g, " "));

try {
  // ── Comptes ─────────────────────────────────────────────────────────────
  const admin = await collaborateur("admin", "admin");
  const recrue = await collaborateur("recrue", "photo");
  const recrueSansRib = await collaborateur("recrue-sans-rib", "photo");
  const rh = await collaborateur("rh", "rh");
  const expert = await collaborateur("expert", "expert_comptable");
  const auditeur = await collaborateur("auditeur", "auditeur");
  const resp = await collaborateur("responsable", "photo");
  for (const c of [admin, recrue, recrueSansRib, rh, expert, auditeur, resp]) if (!c.acces) throw new Error("jeton absent pour " + c.email);
  // Recrues : exactement l'état que pose invite-collaborateur avec onboarding:true, fiche remplie
  // (statut contractuel), aucun document, aucune formation.
  for (const r of [recrue, recrueSansRib]) {
    await rest(`profiles?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ actif: false, onboarding_started_at: new Date().toISOString(), type_contrat: "freelance" }) });
  }
  // Responsable d'UN pôle : c'est le cas où le desktop l'emmène d'office dans « Mon pôle ».
  const [pole] = await rest("poles?select=id,nom&order=nom.asc&limit=1");
  await rest(`pole_affectations?user_id=eq.${resp.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await rest("pole_affectations", { method: "POST", body: JSON.stringify({ pole_id: pole.id, user_id: resp.id, role_pole: "responsable" }) });

  // ── Décision 1 : intégration ───────────────────────────────────────────
  console.log("Decision 1 — recrue en integration : les formations ne bloquent plus l'activation");
  {
    const page = await ouvrir(admin);
    const fiche = async (id) => { await page.evaluate((i) => modalFicheCollaborateur(i), id); await page.waitForTimeout(3500); };
    const bouton = () => page.evaluate(() => { const b = [...document.querySelectorAll("#sv-modal-ct button")].find((x) => /Activer le collaborateur/.test(x.textContent)); return b ? { present: true, actif: !b.disabled } : { present: false }; });

    // Le RIB puis le contrat, ajoutés par le vrai formulaire de la fiche (« Présent »).
    const ajouterDoc = async (type, nom) => {
      await page.evaluate((i) => modalFicheDocAjouter(i), recrue.id); await page.waitForTimeout(400);
      await page.selectOption("#fda-type", type); await page.fill("#fda-nom", nom); await page.selectOption("#fda-statut", { label: "Présent" });
      await page.evaluate((i) => ficheDocAjouter(i), recrue.id); await page.waitForTimeout(2500);
      return page.evaluate(() => document.getElementById("fda-err")?.textContent || "");
    };
    const errRib = await ajouterDoc("rib", "RIB Zz");
    const errContrat = await ajouterDoc("contrat", "Contrat Zz");
    const docs = await rest(`collaborateur_documents?collaborateur_id=eq.${recrue.id}&select=type,statut`);
    t("le formulaire « Présent » de la fiche enregistre le RIB et le contrat", docs.length === 2 && !errRib && !errContrat, `documents en base : ${JSON.stringify(docs)} — erreurs : « ${errRib} » « ${errContrat} »`);

    await fiche(recrue.id);
    const m = await modale(page);
    const b = await bouton();
    t("la checklist coche RIB reçu et Contrat signé", (m.match(/✅/g) || []).length >= 4, m.slice(0, 300));
    t("les formations restent affichées, comme suivi, sans bloquer", /Formations obligatoires \(0\/\d\).*ne bloquent pas l'activation/.test(m), m.slice(0, 400));
    t("dossier administratif complet, formations non faites : « Activer » est cliquable", b.present && b.actif, JSON.stringify(b));

    // Contre-épreuve : un élément administratif manquant bloque toujours.
    await page.evaluate(() => closeModal()); await fiche(recrueSansRib.id);
    const b2 = await bouton();
    t("sans RIB ni contrat, « Activer » reste bloqué", b2.present && !b2.actif, JSON.stringify(b2));

    // Activation réelle.
    await page.evaluate(() => closeModal()); await fiche(recrue.id);
    if (b.actif) {
      await page.evaluate(() => [...document.querySelectorAll("#sv-modal-ct button")].find((x) => /Activer le collaborateur/.test(x.textContent)).click());
      await page.waitForTimeout(2500);
    }
    const [p] = await rest(`profiles?id=eq.${recrue.id}&select=actif`);
    t("le clic ouvre réellement l'accès (profiles.actif = true)", p?.actif === true, JSON.stringify(p));
    t("aucune erreur JavaScript", page.erreurs.length === 0, page.erreurs.join(" | "));
    await page.context().close();
  }

  // ── Décision 4 : mobile 390 px ─────────────────────────────────────────
  console.log("\nDecision 4 — accueil mobile de son propre role (390 px)");
  const ADMIN_MOBILE = /CA ENCAISSÉ CE MOIS/i;
  for (const [c, lib] of [[rh, "RH"], [expert, "expert-comptable"], [auditeur, "auditeur"]]) {
    // Aucun de ces rôles n'a d'accueil mobile à lui : il doit retrouver son accueil desktop.
    const bureau = await ouvrir(c);
    const accueilBureau = (await texte(bureau)).slice(0, 60);
    await bureau.context().close();
    const page = await ouvrir(c, { largeur: 390, hauteur: 844 });
    const x = await texte(page);
    const heros = await page.evaluate(() => (document.querySelector("#app-ct .mhero")?.innerText || "").replace(/\s+/g, " "));
    if (heros) console.log(`       ${lib} voyait : « ${heros} »`);
    t(`${lib} : plus le tableau de bord mobile de l'Admin`, !ADMIN_MOBILE.test(x), x.slice(0, 160));
    t(`${lib} : le même accueil qu'en desktop`, accueilBureau.length > 20 && x.startsWith(accueilBureau), `desktop « ${accueilBureau} » / mobile « ${x.slice(0, 60)} »`);
    t(`${lib} : aucune erreur JavaScript`, page.erreurs.length === 0, page.erreurs.join(" | "));
    await page.context().close();
  }
  {
    const page = await ouvrir(resp, { largeur: 390, hauteur: 844 });
    await page.waitForTimeout(3000);
    const vue = await page.evaluate(() => S.view);
    const x = await texte(page);
    t("Responsable de pôle : arrive sur « Mon pôle » en mobile", vue === "poledash" && x.includes(pole.nom), `vue=${vue} — ${x.slice(0, 160)}`);
    t("Responsable de pôle : aucune erreur JavaScript", page.erreurs.length === 0, page.erreurs.join(" | "));
    await page.context().close();
  }
  {
    // Témoin : l'Admin garde SON tableau de bord mobile.
    const page = await ouvrir(admin, { largeur: 390, hauteur: 844 });
    t("Admin : garde son tableau de bord mobile", ADMIN_MOBILE.test(await texte(page)));
    await page.context().close();
  }

  // ── Décision 5 : nouvelle version ──────────────────────────────────────
  console.log("\nDecision 5 — nouvelle version disponible");
  const bandeau = (page) => page.evaluate(() => { const b = document.getElementById("sv-nouvelle-version"); return b ? b.innerText.replace(/\s+/g, " ") : ""; });
  const revenirSurOnglet = (page) => page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  {
    versionServie = { statut: 200, commit: "aaaa111" };
    const page = await ouvrir(rh);
    await page.evaluate(() => { window.zzPasRecharge = true; });
    await revenirSurOnglet(page); await page.waitForTimeout(1200);
    t("même commit : aucun bandeau", (await bandeau(page)) === "");
    versionServie = { statut: 200, commit: "bbbb222" };
    await revenirSurOnglet(page); await page.waitForTimeout(1200);
    const b = await bandeau(page);
    t("retour sur l'onglet après un déploiement : le bandeau apparaît", /nouvelle version de l'OS est disponible/i.test(b) && /Recharger/.test(b), b);
    t("aucun rechargement automatique", await page.evaluate(() => window.zzPasRecharge === true));
    if (b) {
      await page.click("#sv-nouvelle-version button"); await page.waitForTimeout(5000);
      t("« Recharger » recharge la page", await page.evaluate(() => window.zzPasRecharge !== true));
    }
    await page.context().close();
  }
  {
    // Onglet laissé ouvert, jamais quitté : la vérification périodique (5 min) suffit.
    versionServie = { statut: 200, commit: "aaaa111" };
    const page = await ouvrir(rh, { avantChargement: (p) => p.clock.install() });
    await page.clock.runFor(8000);
    versionServie = { statut: 200, commit: "cccc333" };
    await page.clock.runFor(5 * 60 * 1000 + 1000);
    await page.waitForTimeout(800);
    t("sans quitter l'onglet : bandeau au bout de 5 minutes", /nouvelle version/i.test(await bandeau(page)));
    await page.context().close();
  }
  for (const [statut, lib] of [[404, "absent"], [500, "en erreur"]]) {
    versionServie = { statut: 200, commit: "aaaa111" };
    const page = await ouvrir(rh);
    versionServie = { statut, commit: "" };
    await revenirSurOnglet(page); await page.waitForTimeout(1200);
    t(`version.json ${lib} ensuite : aucun bandeau, aucune erreur`, (await bandeau(page)) === "" && page.erreurs.length === 0, page.erreurs.join(" | "));
    await page.context().close();
  }
  {
    versionServie = { statut: 404, commit: "" };
    const page = await ouvrir(rh);
    versionServie = { statut: 200, commit: "dddd444" };
    await revenirSurOnglet(page); await page.waitForTimeout(1200);
    t("version.json absent au chargement : rien à comparer, aucun bandeau", (await bandeau(page)) === "");
    await page.context().close();
  }
} catch (e) {
  t("le test s'est déroulé jusqu'au bout", false, String(e?.stack || e).slice(0, 400));
} finally {
  await nav.close();
  // ── Nettoyage, vérifié ─────────────────────────────────────────────────
  if (crees.length) {
    const ids = crees.map((i) => `'${i}'`).join(",");
    // collaborateur_documents.uploaded_by n'a pas de ON DELETE : tant que les documents déposés
    // par l'admin de test existent, son compte refuse de partir (constaté au premier passage).
    await sql(`delete from collaborateur_documents where collaborateur_id in (${ids}) or uploaded_by in (${ids});
      delete from notifications where destinataire_id in (${ids}) or expediteur_id in (${ids});
      delete from activity_log where acteur_id in (${ids});`);
    for (const id of crees) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  }
  await sql(`delete from notification_attempts where outbox_id in (select id from notification_outbox where lower(recipient_email) like '${MOTIF}');
    delete from notification_outbox where lower(recipient_email) like '${MOTIF}';
    delete from communication_suppressions where address like '${MOTIF}';`);
  const reste = await sql(`select (select count(*) from auth.users where email like '${MOTIF}') u,
    (select count(*) from profiles where email like '${MOTIF}') p,
    (select count(*) from communication_suppressions where address like '${MOTIF}') s`);
  const r0 = Array.isArray(reste) ? reste[0] : {};
  t("nettoyage : aucun compte, profil ni inscription de test ne subsiste", r0.u === 0 && r0.p === 0 && r0.s === 0, JSON.stringify(reste));
  process.exit(bilan() ? 1 : 0);
}
