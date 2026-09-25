// Un coach qui ouvre « Espace club » depuis l'application est deja connecte (25/09/2026).
//
// TROUVE EN AUDITANT L'APPLICATION : le bouton « Espace club » ouvrait Club+ dans une fenetre, et
// Club+ y demandait un mot de passe. Le coach venait de se connecter dans l'application trente
// secondes plus tot. Personne ne se reconnecte, on referme.
//
// LA MEME SOLUTION QUE POUR CONNECT, et pour la meme raison technique : sur iOS, react-native-webview
// ignore purement et simplement `source.method` et `source.body` (RNCWebViewImpl.m ne lit ni
// httpMethod ni httpBody). Une fenetre ne peut donc pas POSTER un jeton. On charge a la place un
// formulaire HTML qui se soumet tout seul, avec `baseUrl` pour que l'origine soit la bonne.
//
// POURQUOI UN POST ET PAS L'URL. Un jeton dans une URL finit dans l'historique, dans les journaux
// du serveur, et dans le referer de la premiere image chargee. Le corps d'un POST ne va nulle part.
//
// CE QUE LE TEST VERIFIE, sur le vrai Club+ deploye, avec un vrai compte coach :
//   1. /clubplus/auth/app repond 303 et pose le biscuit de session.
//   2. La page d'arrivee s'ouvre en 200 SANS champ de mot de passe : la session a pris.
//   3. Elle porte data-app="1", le marqueur qui masque le menu et l'entete de Club+ — sinon la
//      navigation de Club+ se superpose a la barre de l'application, et on a deux menus.
//   4. Un `next` etranger est refuse : une redirection ouverte servirait a voler la session.
import { SB, ANON } from "./_session-os.mjs";

const CLUBPLUS = "https://clubplus.sportvision-an.fr";
const MDP = "DemoSportVision2026!";
const COACH = "demo.coach.villemomble@example.invalid";

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: COACH, password: MDP }) });
const s = await r.json();
if (!s.access_token) { console.log(`Connexion impossible pour ${COACH} : ${JSON.stringify(s).slice(0, 200)}`); process.exit(1); }
console.log(`Compte coach reel : ${COACH}\n`);

/** Reproduit exactement ce que la fenetre de l'application envoie. */
async function poser(chemin) {
  const corps = new URLSearchParams({
    access_token: s.access_token, refresh_token: s.refresh_token, next: chemin });
  return fetch(`${CLUBPLUS}/clubplus/auth/app`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps.toString(), redirect: "manual" });
}

// Les cinq ecrans que le bouton « Espace club » sert vraiment a un coach. Les noms sont ceux des
// routes reelles : « /equipes » et « /effectifs » n'existent pas, ils rendaient 404 — verifie.
const PAGES = ["/clubplus/dashboard", "/clubplus/teams", "/clubplus/calendar",
               "/clubplus/presences", "/clubplus/galeries"];

const redirigees = [], reconnexions = [], sansMarqueur = [], cassees = [];

for (const page of PAGES) {
  const h = await poser(page);
  if (h.status !== 303) { redirigees.push(`${page} → handoff HTTP ${h.status}`); continue; }
  const biscuits = (h.headers.getSetCookie ? h.headers.getSetCookie() : [h.headers.get("set-cookie")])
    .filter(Boolean).map((c) => c.split(";")[0]).join("; ");
  const p = await fetch(new URL(h.headers.get("location"), CLUBPLUS), {
    headers: { cookie: biscuits }, redirect: "manual" });
  if (p.status !== 200) { redirigees.push(`${page} → ${p.status} ${p.headers.get("location") ?? ""}`); continue; }
  const html = await p.text();
  if (/Application error: a server-side exception/.test(html)) cassees.push(page);
  else if (/type="password"/.test(html)) reconnexions.push(page);
  else if (!/data-app="1"/.test(html)) sansMarqueur.push(page);
}

t(`les ${PAGES.length} pages de Club+ s'ouvrent avec la session transportee`, redirigees.length === 0, redirigees.join(" | "));
t("aucune ne plante cote serveur", cassees.length === 0, cassees.join(", "));
t("aucune ne redemande le mot de passe", reconnexions.length === 0, reconnexions.join(", "));
t("toutes masquent le menu de Club+ (data-app)", sansMarqueur.length === 0, sansMarqueur.join(", "));

// ── La redirection ouverte ─────────────────────────────────────────────────────────────────
for (const mechant of ["https://exemple-attaquant.test/vol", "//exemple-attaquant.test/vol"]) {
  const h = await poser(mechant);
  const dest = h.headers.get("location") ?? "";
  t(`un « next » vers ${mechant.slice(0, 28)} est refuse`,
    h.status === 303 && !dest.includes("exemple-attaquant"), `→ ${dest}`);
}

// Un GET nu ne doit rien poser : sinon un lien suffirait a semer une session.
const nu = await fetch(`${CLUBPLUS}/clubplus/auth/app`, { redirect: "manual" });
t("un GET sur /auth/app ne pose pas de session", nu.status !== 303 || !(nu.headers.get("set-cookie") ?? "").includes("sv_app"),
  `HTTP ${nu.status}`);

console.log(`\n${ok} verifications passees, ${echecs.length} echec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
