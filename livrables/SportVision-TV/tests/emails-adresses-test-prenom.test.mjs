// Deux défauts de la chaîne d'e-mails, décidés par Fouka le 10/09/2026 : les adresses de test ne
// partent plus chez Brevo, et un prénom manquant ne laisse plus « Bonjour , ».
//
// POURQUOI CE TEST. Sur les 7 jours précédents, Brevo comptait 62 envois, 19 rebonds temporaires et
// 3 définitifs, presque tous vers @example.invalid, @sportvision-test.fr et zz-…@sportvision-an.fr :
// des adresses de test. Chaque rebond abîme la réputation d'envoi de sportvision-an.fr, donc la
// délivrabilité des e-mails des vrais parents. Et l'e-mail de réinitialisation saluait « Bonjour , »
// tout compte Connect : il lisait `prenom`, Connect enregistre `first_name`.
//
// CE QU'IL VÉRIFIE, SANS ENVOYER UN SEUL E-MAIL
//   A. le filtre d'adresses, extrait tel quel de dispatch-notifications ;
//   B. la salutation, sur les gabarits ACTIFS lus en base, rendus par le code livré ;
//   C. le worker lui-même, exécuté sous Deno contre une fausse base, réseau limité à la machine :
//      les lignes de test doivent sortir SUPPRESSED sans jamais tenter Brevo, et une ligne témoin
//      doit, elle, tenter Brevo (bloquée par le bac à sable) — preuve que le banc envoie vraiment ;
//   D. les deux fonctions qui fabriquent les e-mails de compte (request-password-reset,
//      notify-account-change), exécutées en local contre la VRAIE base : on lit le prénom que la
//      vraie file reçoit. Adresses .invalid, bloquées d'avance par la liste de suppression ;
//   E. (PROD_DISPATCH=1, après déploiement) une ligne mise dans la vraie file, traitée par le vrai
//      cron : elle doit sortir SUPPRESSED avec la raison. Protégée par la liste de suppression,
//      donc sans envoi même avant le déploiement (où elle sort SUPPRESSED sans raison : rouge).
//
// ROUGE AVANT. `REF_GIT=origin/main` exécute A à D sur le code d'une autre révision (lu par
// git show) au lieu du code du dépôt.
//
//   node livrables/SportVision-TV/tests/emails-adresses-test-prenom.test.mjs
//   REF_GIT=origin/main node livrables/SportVision-TV/tests/emails-adresses-test-prenom.test.mjs
//   PROD_DISPATCH=1 node livrables/SportVision-TV/tests/emails-adresses-test-prenom.test.mjs

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { rapporteur, SB, KEY, ANON, env, enTeteAdmin } from "./_session-os.mjs";

const { t, bilan } = rapporteur();
const T0 = Date.now();
const REF_GIT = process.env.REF_GIT || "";
const FONCTIONS = new URL("../supabase/functions/", import.meta.url).pathname;
const REF = SB.replace(/^https:\/\/([^.]+)\..*$/, "$1");
const adresse = (objet) => `zz-cx-dec-${objet}-${T0}@example.invalid`;

// Le code testé : celui du dépôt, ou celui d'une autre révision (REF_GIT) recopié à part.
let dossier = FONCTIONS;
if (REF_GIT) {
  dossier = mkdtempSync(join(tmpdir(), "zz-cx-dec-"));
  for (const f of ["dispatch-notifications", "request-password-reset", "notify-account-change"]) {
    mkdirSync(join(dossier, f));
    const src = execFileSync("git", ["show", `${REF_GIT}:livrables/SportVision-TV/supabase/functions/${f}/index.ts`], { encoding: "utf8" });
    writeFileSync(join(dossier, f, "index.ts"), src);
  }
  console.log(`Code testé : révision ${REF_GIT}`);
}
const srcDispatch = readFileSync(join(dossier, "dispatch-notifications", "index.ts"), "utf8");

// ── Extraction des fonctions livrées (même méthode que emails-rendu.test.mjs) ──
function extraire(src, nom) {
  const i = src.indexOf(`function ${nom}(`);
  if (i === -1) return null;
  let k = src.indexOf("(", i), par = 0;
  for (; k < src.length; k++) {
    if (src[k] === "(") par++;
    else if (src[k] === ")" && --par === 0) break;
  }
  const debutCorps = src.indexOf("{", k);
  let p = 0;
  for (let j = debutCorps; j < src.length; j++) {
    if (src[j] === "{") p++;
    else if (src[j] === "}" && --p === 0) return src.slice(i, j + 1);
  }
  return null;
}
const ts = (await import("../../SportVision-Connect/app-next/node_modules/typescript/lib/typescript.js")).default;
const morceaux = ["escHtml", "renderTemplate", "adresseNonDistribuable"].map((n) => extraire(srcDispatch, n) || `function ${n}(){return null}`);
const { renderTemplate, adresseNonDistribuable } = new Function(
  ts.transpileModule(morceaux.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText +
    "\nreturn {renderTemplate, adresseNonDistribuable};",
)();

const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });
const authApi = (c, o = {}) => fetch(`${SB}/auth/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });
// Lecture seule des gabarits actifs (l'API Management s'exécute en postgres : elle ne prouve rien
// sur des droits, et ce test ne vérifie aucun droit).
async function sqlLecture(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return r.json();
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\nA. Le filtre d'adresses de dispatch-notifications");
{
  const bloquees = [
    adresse("filtre"), "parent@club.test", "a@example", "a@localhost", "a@example.com", "a@mail.example.org",
    "a@example.net", "coach@sportvision-test.fr", "zz-cx-dec-coach@sportvision-an.fr", "ZZ-Maj@SportVision-AN.fr",
    "  espaces@example.invalid.  ",
  ];
  const envoyables = [
    "parent@gmail.com", "contact@sportvision-an.fr", "zz@gmail.com", "a@example.fr", "a@myexample.com",
    "a@test.fr", "a@invalid.fr", "zzz@orange.fr", "anna-zz-@sportvision-an.fr",
  ];
  const ratees = bloquees.filter((a) => !adresseNonDistribuable(a));
  t(`les ${bloquees.length} adresses de test ou réservées sont bloquées`, ratees.length === 0, `laissées passer : ${ratees.join(", ")}`);
  const bloqueesATort = envoyables.filter((a) => adresseNonDistribuable(a));
  t(`les ${envoyables.length} vraies adresses passent`, bloqueesATort.length === 0, `bloquées à tort : ${bloqueesATort.join(", ")}`);
  const raison = adresseNonDistribuable(adresse("raison")) || "";
  t("la raison est lisible", /réservé|test/.test(raison), raison);

  // Le contrôle doit précéder tout ce qui pourrait mener à Brevo : clé, gabarit, envoi.
  const iFiltre = srcDispatch.indexOf("adresseNonDistribuable(row.recipient_email)");
  const iCle = srcDispatch.indexOf("if (!brevoApiKey)");
  const iEnvoi = srcDispatch.indexOf("await sendViaBrevo(");
  t("il est appliqué avant la clé Brevo, le gabarit et l'envoi", iFiltre > 0 && iFiltre < iCle && iFiltre < iEnvoi);
  t("la fonction garde son authentification par secret partagé (inchangée)",
    srcDispatch.includes('Deno.env.get("DISPATCH_NOTIFICATIONS_SECRET")') && srcDispatch.includes("providedSecret !== expectedSecret"));

  // clubplus-family-invite envoie par Resend, hors de la file : il porte une copie de la même règle.
  if (!REF_GIT) {
    const srcFamille = readFileSync(join(FONCTIONS, "clubplus-family-invite", "index.ts"), "utf8");
    const copie = extraire(srcFamille, "adresseNonDistribuable");
    t("clubplus-family-invite applique la même règle, copie identique", copie !== null && copie === extraire(srcDispatch, "adresseNonDistribuable"));
    const iGarde = srcFamille.indexOf("adresseNonDistribuable(info.to)");
    t("… avant tout appel à Resend", iGarde > 0 && iGarde < srcFamille.indexOf('fetch("https://api.resend.com/emails"'));
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\nB. La salutation, sur les gabarits actifs en production");
const gabarits = await sqlLecture(`select t.template_key, v.subject_template, v.body_html_template
  from communication_template_versions v join communication_templates t on t.id = v.template_id
  where v.active_from <= now() and (v.active_to is null or v.active_to > now())`);
{
  t("gabarits actifs lus", Array.isArray(gabarits) && gabarits.length >= 10, JSON.stringify(gabarits).slice(0, 160));
  const avecPrenom = (gabarits || []).filter((g) => /\{\{(first_name|prenom)\}\}/.test(g.subject_template + g.body_html_template));
  const fautes = [];
  for (const g of avecPrenom) {
    // Toutes les autres variables sont renseignées : seul le trou laissé par le prénom est jugé.
    const autres = Object.fromEntries([...(g.subject_template + g.body_html_template).matchAll(/\{\{(\w+)\}\}/g)].map((m) => [m[1], "X"]));
    for (const noms of [{ first_name: undefined, prenom: undefined }, { first_name: "", prenom: "" }, { first_name: "  ", prenom: null }]) {
      const vide = { ...autres, ...noms };
      // Balises retirées sans les remplacer par un espace, pour n'en créer aucun. Un défaut, c'est
      // une espace avant une virgule (« Bonjour , ») ou deux espaces avant une ponctuation
      // (« Merci  ! »), là où le prénom manquant a laissé son trou.
      for (const rendu of [renderTemplate(g.subject_template, vide), renderTemplate(g.body_html_template, vide, { escape: true }).replace(/<[^>]+>/g, "")]) {
        const m = rendu.match(/.{0,20}([ \t ],|[ \t ]{2,}[!?:;—]).{0,10}/);
        if (m) fautes.push(`${g.template_key} : « ${m[0].trim()} »`);
      }
      if (fautes.length) break;
    }
  }
  t(`sans prénom, aucun des ${avecPrenom.length} gabarits concernés n'affiche « Bonjour , » ni « Merci  ! »`, fautes.length === 0, fautes.join("\n       "));
  const reset = (gabarits || []).find((g) => g.template_key === "auth.password_reset");
  const avecNom = renderTemplate(reset?.body_html_template, { first_name: "Zoé" }, { escape: true });
  t("avec un prénom : « Bonjour Zoé, »", avecNom.includes("Bonjour Zoé,"));
  t("sans prénom : « Bonjour, »", renderTemplate(reset?.body_html_template, {}, { escape: true }).includes("Bonjour,"));
  t("une autre variable vide ne change pas de forme (seuls les prénoms sont concernés)",
    renderTemplate("Montant : {{montant}} €", {}) === "Montant :  €" && renderTemplate("A {{x}}B", { x: "1" }) === "A 1B");
  t("un prénom reste échappé dans le HTML", renderTemplate("Bonjour {{first_name}},", { first_name: "<b>Zoé</b>" }, { escape: true }) === "Bonjour &lt;b&gt;Zoé&lt;/b&gt;,");
}

// ═════════════════════════════════════════════════════════════════════════
// Lance une fonction du dossier testé sous Deno (port 8000, celui de std/http/serve).
async function lancerFonction(nom, envFn, reseau) {
  const args = ["run", "--allow-env", "--allow-read", reseau ? `--allow-net=${reseau}` : "--allow-net", "index.ts"];
  const p = spawn("deno", args, { cwd: join(dossier, nom), env: { ...process.env, ...envFn }, stdio: ["ignore", "ignore", "pipe"] });
  let erreurs = "";
  p.stderr.on("data", (d) => { erreurs += d; });
  for (let i = 0; i < 120; i++) {
    try { await fetch("http://localhost:8000/", { method: "OPTIONS" }); return { p, erreurs: () => erreurs }; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  p.kill();
  throw new Error(`${nom} ne démarre pas : ${erreurs.slice(0, 300)}`);
}
const arreter = async (f) => { f.p.kill(); await new Promise((r) => setTimeout(r, 400)); };

console.log("\nC. Le worker exécuté pour de vrai, contre une fausse base, sans accès à Internet");
{
  const temoin = "temoin.decisions@orange.fr"; // jamais contacté : le bac à sable coupe Internet
  const lignes = [adresse("worker"), "coach@sportvision-test.fr", "zz-cx-dec-worker@sportvision-an.fr", "parent@example.com", temoin]
    .map((a, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i + 1}`, event_type: "test", channel: "EMAIL", template_key: "auth.password_reset",
      recipient_email: a, recipient_user_id: null, payload_json: { first_name: "", reset_url: "https://example.invalid/", expires_at_local: "-" },
      status: "PENDING", attempt_count: 0, scheduled_at: new Date(T0 + i).toISOString(),
    }));
  const reset = (gabarits || []).find((g) => g.template_key === "auth.password_reset");
  const ecritures = [];
  const faux = createServer(async (req, res) => {
    let corps = "";
    for await (const c of req) corps += c;
    const u = new URL(req.url, "http://x");
    const table = u.pathname.replace("/rest/v1/", "");
    const unObjet = /vnd\.pgrst\.object/.test(req.headers.accept || "");
    const rendre = (v) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(unObjet ? (Array.isArray(v) ? v[0] ?? null : v) : v));
    if (req.method === "GET" && table === "notification_outbox") return rendre(lignes);
    if (req.method === "GET" && table === "communication_template_versions") {
      return rendre([{ version: 1, subject_template: reset.subject_template, body_html_template: reset.body_html_template,
        communication_templates: { template_key: "auth.password_reset", category: "SECURITY", mandatory: true } }]);
    }
    if (req.method === "GET") return rendre([]);
    ecritures.push({ methode: req.method, table, filtre: u.search, corps: corps ? JSON.parse(corps) : null });
    res.writeHead(req.method === "POST" ? 201 : 204).end();
  });
  await new Promise((r) => faux.listen(0, "127.0.0.1", r));
  const port = faux.address().port;
  const SECRET = "zz-cx-dec-secret-local";
  const fn = await lancerFonction("dispatch-notifications", {
    SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: "cle-factice", BREVO_API_KEY: "cle-factice",
    DISPATCH_NOTIFICATIONS_SECRET: SECRET,
  }, `0.0.0.0:8000,localhost:8000,127.0.0.1:${port}`);
  try {
    const refus = await fetch("http://localhost:8000/", { method: "POST" });
    t("sans le secret partagé, la fonction refuse (401)", refus.status === 401, `HTTP ${refus.status}`);
    const r = await fetch("http://localhost:8000/", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } });
    const rep = await r.text();
    for (const l of lignes.slice(0, 4)) {
      const w = ecritures.find((e) => e.table === "notification_outbox" && e.filtre.includes(l.id));
      t(`${l.recipient_email} : SUPPRESSED, avec la raison, sans tentative`,
        w?.corps?.status === "SUPPRESSED" && /Adresse de test/.test(w?.corps?.last_error || ""),
        w ? JSON.stringify(w.corps) : `aucune écriture — réponse du worker : ${rep.slice(0, 200)}`);
    }
    const tentatives = ecritures.filter((e) => e.table === "notification_attempts");
    t("aucune tentative d'envoi enregistrée pour les adresses de test", tentatives.length === 0, JSON.stringify(tentatives).slice(0, 200));
    // Le témoin, lui, doit arriver jusqu'à l'appel Brevo : c'est ce qui prouve que le banc fait
    // bien tourner la vraie boucle d'envoi, et que les lignes de test ont été arrêtées par le filtre.
    t("la ligne témoin, elle, va jusqu'à l'appel Brevo (coupé par le bac à sable)", r.status === 500 && /api\.brevo\.com/.test(rep), `HTTP ${r.status} ${rep.slice(0, 160)}`);
  } finally {
    await arreter(fn);
    faux.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\nD. Les e-mails de compte : le prénom que la vraie file reçoit");
const aNettoyer = { comptes: [], adresses: [] };
// Liste de suppression, VÉRIFIÉE : `reason` n'accepte que hard_bounce, complaint, unsubscribe ou
// manual. Un premier passage de ce test écrivait un libellé libre ; l'insertion était refusée sans
// que rien ne le dise, et le worker en production a envoyé la ligne de la section E (10/09/2026).
// Désormais, une liste de suppression qui ne prend pas arrête le test avant toute mise en file.
async function bloquer(email) {
  const r = await api("communication_suppressions", { method: "POST", body: JSON.stringify({ channel: "EMAIL", address: email.toLowerCase(), reason: "manual" }) });
  if (!r.ok) throw new Error(`liste de suppression refusée pour ${email} : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}
async function creerCompte(objet, meta) {
  const email = adresse(objet);
  aNettoyer.adresses.push(email);
  // Liste de suppression AVANT tout : le worker en production ne l'enverra jamais, même non déployé.
  await bloquer(email);
  const u = await (await authApi("admin/users", { method: "POST", body: JSON.stringify({ email, password: "ZzDecisions!2026", email_confirm: true, user_metadata: meta }) })).json();
  if (u.id) aNettoyer.comptes.push(u.id);
  return { id: u.id, email };
}
async function ligneFile(email, gabarit) {
  for (let i = 0; i < 10; i++) {
    const l = (await (await api(`notification_outbox?select=payload_json,status&recipient_email=eq.${encodeURIComponent(email)}&template_key=eq.${gabarit}`)).json())[0];
    if (l) return l;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
try {
  const connect = await creerCompte("prenom-connect", { first_name: "Zoé", last_name: "ZZDecisions" });
  const os = await creerCompte("prenom-os", { prenom: "Marc", nom: "ZZDecisions" });
  const anonyme = await creerCompte("prenom-aucun", {});
  const reset = (gabarits || []).find((g) => g.template_key === "auth.password_reset");

  const fr = await lancerFonction("request-password-reset", { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: KEY });
  try {
    for (const [c, attendu, libelle] of [[connect, "Zoé", "compte Connect (first_name)"], [os, "Marc", "compte OS (prenom)"], [anonyme, "", "compte sans prénom"]]) {
      // Une « adresse IP » propre à ce passage : sans elle, la fonction locale compte tous les
      // appels sous « inconnu », et la limite de 5 par heure fait taire le 6e sans rien dire.
      await fetch("http://localhost:8000/", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `zz-cx-dec-${T0}` }, body: JSON.stringify({ email: c.email, redirect_url: "https://connect.sportvision-an.fr/auth/reset" }) });
      const l = await ligneFile(c.email, "auth.password_reset");
      t(`réinitialisation, ${libelle} : prénom transmis « ${attendu} »`, l && (l.payload_json?.first_name ?? "") === attendu, JSON.stringify(l?.payload_json?.first_name));
      const rendu = renderTemplate(reset?.body_html_template, l?.payload_json || {}, { escape: true });
      t(`… et l'e-mail rendu dit « ${attendu ? `Bonjour ${attendu},` : "Bonjour,"} »`, rendu.includes(attendu ? `Bonjour ${attendu},` : "Bonjour,") && !/Bonjour\s+,/.test(rendu));
    }
  } finally { await arreter(fr); }

  const fn = await lancerFonction("notify-account-change", { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: KEY });
  try {
    const jeton = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: connect.email, password: "ZzDecisions!2026" }) })).json()).access_token;
    await fetch("http://localhost:8000/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` }, body: JSON.stringify({ type: "password_changed" }) });
    const l = await ligneFile(connect.email, "auth.password_changed");
    t("mot de passe modifié, compte Connect : prénom transmis « Zoé »", l?.payload_json?.first_name === "Zoé", JSON.stringify(l?.payload_json?.first_name));
  } finally { await arreter(fn); }
} finally {
  // ── Nettoyage vérifié ──
  for (const a of aNettoyer.adresses) {
    await api(`notification_outbox?recipient_email=eq.${encodeURIComponent(a)}`, { method: "DELETE" });
    await api(`communication_suppressions?address=eq.${encodeURIComponent(a)}`, { method: "DELETE" });
    await api(`guest_rate_limits?identifiant=eq.${encodeURIComponent("pwreset:email:" + a)}`, { method: "DELETE" });
  }
  await api(`guest_rate_limits?identifiant=eq.${encodeURIComponent(`pwreset:ip:zz-cx-dec-${T0}`)}`, { method: "DELETE" });
  for (const id of aNettoyer.comptes) await authApi(`admin/users/${id}`, { method: "DELETE" });
  const restes = (await sqlLecture(`select (select count(*) from auth.users where email like 'zz-cx-dec-prenom-%${T0}@example.invalid') comptes,
    (select count(*) from notification_outbox where recipient_email like 'zz-cx-dec-%${T0}@example.invalid') file,
    (select count(*) from communication_suppressions where address like 'zz-cx-dec-%${T0}@example.invalid') suppressions,
    (select count(*) from guest_rate_limits where identifiant like '%zz-cx-dec-%${T0}%') limites`))?.[0] || {};
  t("rien ne subsiste (comptes, file, liste de suppression, limites de fréquence)",
    [restes.comptes, restes.file, restes.suppressions, restes.limites].every((n) => Number(n) === 0), JSON.stringify(restes));
}

// ═════════════════════════════════════════════════════════════════════════
if (process.env.PROD_DISPATCH === "1") {
  console.log("\nE. La vraie file, traitée par le vrai cron (fonction déployée)");
  const email = adresse("prod");
  await bloquer(email);
  try {
    await api("notification_outbox", { method: "POST", body: JSON.stringify({
      event_type: "test.decisions_connect", channel: "EMAIL", template_key: "auth.password_reset", recipient_email: email,
      idempotency_key: `zz-cx-dec-prod-${T0}`, payload_json: { first_name: "", reset_url: "https://example.invalid/", expires_at_local: "-" },
    }) });
    let l = null;
    for (let i = 0; i < 60; i++) {
      l = (await (await api(`notification_outbox?select=status,last_error,attempt_count&recipient_email=eq.${encodeURIComponent(email)}`)).json())[0];
      if (l && l.status !== "PENDING") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    t("la ligne de test sort SUPPRESSED avec la raison « adresse de test »", l?.status === "SUPPRESSED" && /Adresse de test/.test(l?.last_error || ""), JSON.stringify(l));
    t("sans aucune tentative d'envoi", l && l.attempt_count === 0, JSON.stringify(l));
  } finally {
    await api(`notification_outbox?recipient_email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
    await api(`communication_suppressions?address=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  }
}

if (REF_GIT) rmSync(dossier, { recursive: true, force: true });
process.exit(bilan() ? 1 : 0);
