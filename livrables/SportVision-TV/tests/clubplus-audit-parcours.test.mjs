// Les 48 ecrans de Club+, ouverts un par un avec un vrai compte coach (25/09/2026).
//
// MEME METHODE QUE POUR CONNECT ET POUR L'APPLICATION : on ne relit pas le code en se demandant
// s'il a l'air juste, on regarde ce qu'un vrai compte recoit du vrai serveur.
//
// CE QUE LE TEST SEPARE, et c'est tout son interet :
//
//   REDIRIGE      Un coach n'a pas acces a la facturation ni aux utilisateurs. Etre renvoye
//                 ailleurs est le comportement VOULU (permissions CM/Club V1, figees le 10/09).
//                 Ce n'est donc pas un echec — mais on l'imprime, parce qu'une redirection de
//                 trop est une fonction perdue, et une redirection de moins une fuite.
//   CASSE         Next.js a plante cote serveur. Toujours un bug.
//   RECONNEXION   Un champ de mot de passe alors que la session est valable : le transport n'a
//                 pas pris. Toujours un bug.
//   QUASI VIDE    Moins de 2 ko rendus : l'ecran n'a rien affiche. Suspect, pas une preuve.
//
// Le transport de session est celui de l'application : POST vers /clubplus/auth/app, biscuit,
// puis la page. C'est exactement le chemin qu'emprunte le bouton « Espace club ».
import { SB, ANON } from "./_session-os.mjs";

const CLUBPLUS = "https://clubplus.sportvision-an.fr";
const MDP = "DemoSportVision2026!";
const COACH = "demo.coach.villemomble@example.invalid";

const ECRANS = [
  "/dashboard", "/teams", "/children", "/presences", "/sessions", "/calendar",
  "/matchcenter", "/events", "/eventtimeline", "/live", "/galeries", "/media",
  "/media-sales", "/content", "/publications", "/newsroom", "/communication",
  "/studio", "/messages", "/notifications", "/notifications/preferences",
  "/requests", "/requests/new", "/team-requests", "/validations", "/services",
  "/services/new", "/appointments", "/accompagnement", "/analytics", "/reports",
  "/documents", "/contracts", "/authorizations", "/invitations", "/users",
  "/billing", "/sponsors", "/camps", "/campsessions", "/mycm", "/onboarding",
  "/season-transition", "/settings", "/settings/profile", "/settings/organization",
  "/settings/integrations", "/support",
];

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

const a = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: COACH, password: MDP }) });
const s = await a.json();
if (!s.access_token) { console.log(`Connexion impossible : ${JSON.stringify(s).slice(0, 200)}`); process.exit(1); }
console.log(`Compte : ${COACH} (coach, SF Villemomble)\n`);

const redirige = [], casse = [], reconnexion = [], vide = [], sansMarqueur = [], ouverts = [];

for (const ecran of ECRANS) {
  const corps = new URLSearchParams({
    access_token: s.access_token, refresh_token: s.refresh_token, next: `/clubplus${ecran}` });
  const h = await fetch(`${CLUBPLUS}/clubplus/auth/app`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps.toString(), redirect: "manual" });
  if (h.status !== 303) { casse.push(`${ecran} (handoff HTTP ${h.status})`); continue; }
  const biscuits = (h.headers.getSetCookie ? h.headers.getSetCookie() : [h.headers.get("set-cookie")])
    .filter(Boolean).map((c) => c.split(";")[0]).join("; ");
  const p = await fetch(new URL(h.headers.get("location"), CLUBPLUS), {
    headers: { cookie: biscuits }, redirect: "manual" });
  if (p.status !== 200) { redirige.push(`${ecran} → ${p.status} ${p.headers.get("location") ?? ""}`); continue; }
  const html = await p.text();
  if (/Application error: a server-side exception/.test(html)) casse.push(ecran);
  else if (/type="password"/.test(html)) reconnexion.push(ecran);
  else {
    ouverts.push(ecran);
    if (!/data-app="1"/.test(html)) sansMarqueur.push(ecran);
    if (html.length < 2000) vide.push(`${ecran} (${html.length} o)`);
  }
}

console.log(`\n${ouverts.length} ecrans ouverts, ${redirige.length} rediriges.\n`);
t("aucun ecran ne plante cote serveur", casse.length === 0, casse.join(", "));
t("aucun ecran ne redemande le mot de passe", reconnexion.length === 0, reconnexion.join(", "));
t("aucun ecran ne rend une page quasi vide", vide.length === 0, vide.join(", "));
t("tous masquent le menu de Club+ dans l'application", sansMarqueur.length === 0, sansMarqueur.join(", "));
// Un coach doit au minimum tenir son metier : ses equipes, ses seances, son calendrier, ses medias.
const METIER = ["/dashboard", "/teams", "/presences", "/calendar", "/galeries", "/messages"];
const perdus = METIER.filter((m) => !ouverts.includes(m));
t("le coach garde les ecrans de son metier", perdus.length === 0, perdus.join(", "));

if (redirige.length) {
  console.log("\nRediriges (a verifier une fois : voulu, ou fonction perdue ?) :");
  redirige.forEach((r) => console.log("  · " + r));
}

console.log(`\n${ok} verifications passees, ${echecs.length} echec(s).`);
if (echecs.length) { console.log(""); echecs.forEach((e) => console.log("  ❌ " + e)); }

// ── Ce qu'un coach LIT sur les ecrans du bureau ────────────────────────────────────────────
//
// TROUVE EN AUDITANT : 47 des 48 ecrans repondent 200 a un coach, facturation et membres
// comprises. Un `fetch` ne pouvait pas en juger — Club+ rend ces pages dans le navigateur, et le
// HTML du serveur n'est qu'une coquille. Il fallait donc un vrai navigateur pour voir le texte.
//
// LE VERDICT EST BON, et c'est pour ca qu'on le verrouille ici : chaque ecran du bureau affiche un
// refus ecrit, nomme les roles qui y ont droit, et ne laisse filtrer AUCUN chiffre. C'est mieux
// qu'une redirection muette : le coach comprend pourquoi et a qui s'adresser.
//
// Ce test existe pour qu'un futur changement de droits ne transforme pas ce refus en page ouverte
// sans que rien ne le signale. Le vrai verrou reste la RLS ; ceci verifie l'ecran.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";

console.log("\n═══ LES ECRANS DU BUREAU, DANS UN VRAI NAVIGATEUR ═══\n");

const BUREAU = [
  ["/billing", /r[eé]serv[eé]s au bureau du club/i],
  ["/contracts", /r[eé]serv[eé]s au bureau du club/i],
  ["/users", /r[eé]serv[eé]e? [aà] l.administrateur du club/i],
  ["/settings/organization", /r[eé]serv[eé]es? [aà] l.administrateur du club/i],
];

const nav = await chromium.launch();
try {
  const page = await (await nav.newContext()).newPage();
  // Le meme formulaire auto-soumis que l'application, pour arriver avec la session en place.
  await page.goto(`${CLUBPLUS}/clubplus/auth/login`);
  await page.setContent(`<form id="f" method="POST" action="${CLUBPLUS}/clubplus/auth/app">`
    + `<input name="access_token" value="${s.access_token}">`
    + `<input name="refresh_token" value="${s.refresh_token}">`
    + `<input name="next" value="/clubplus/dashboard"></form>`
    + `<script>document.getElementById("f").submit()</script>`);
  await page.waitForLoadState("networkidle");

  for (const [ecran, refus] of BUREAU) {
    await page.goto(`${CLUBPLUS}/clubplus${ecran}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const texte = (await page.evaluate(
      () => (document.querySelector("main") ?? document.body).innerText)).replace(/\s+/g, " ");
    t(`${ecran} refuse le coach par ecrit`, refus.test(texte), texte.slice(0, 120));
    // Un montant en euros sur un ecran refuse serait une fuite : le refus doit etre total.
    t(`${ecran} ne laisse filtrer aucun montant`, !/\d[\d  ]*[,.]\d{2}\s*€/.test(texte),
      (/\d[\d  ]*[,.]\d{2}\s*€/.exec(texte) ?? [""])[0]);
  }
} finally { await nav.close(); }

console.log(`\n${ok} verifications passees au total, ${echecs.length} echec(s).`);
if (echecs.length) { console.log(""); echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
