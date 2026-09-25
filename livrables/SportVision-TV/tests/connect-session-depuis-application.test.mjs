// L'application mobile remet sa session à Connect, et Connect l'accepte (25/09/2026).
//
// POURQUOI CETTE ROUTE EXISTE. L'application ouvre certaines pages de Connect dans une fenêtre :
// commandes, factures, paiement collectif, affiliation, équipes, messages, prestations,
// reconnaissance. Sans transport de session, une personne déjà connectée retombe sur l'écran de
// connexion en ouvrant « Mes commandes ». Se connecter deux fois pour voir son propre reçu,
// personne ne le fait : elle referme et appelle son club.
//
// CE QUE CE TEST VÉRIFIE, ET POURQUOI CHAQUE POINT COMPTE :
//
//   1. Une vraie session ouvre bien la page demandée, et pas l'écran de connexion.
//   2. Des jetons inventés n'ouvrent rien. La route pose un cookie de session : si elle acceptait
//      n'importe quoi, elle serait une porte d'entrée.
//   3. Le « next » ne peut pas emmener ailleurs que sur ce site. Sans ce garde-fou, un paramètre
//      fabriqué enverrait une personne connectée vers un domaine choisi par quelqu'un d'autre.
//   4. La redirection est un 303 et non un 307 : en 307 le navigateur rejouerait le POST sur la
//      page d'arrivée, avec les jetons dans le corps.
import { SB, ANON } from "./_session-os.mjs";

const CONNECT = "https://connect.sportvision-an.fr";
const MDP = "DemoSportVision2026!";
const COMPTE = "demo.u18.villemomble@example.invalid";

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

async function remettre(acces, rafraichissement, next) {
  const corps = new URLSearchParams({
    access_token: acces ?? "", refresh_token: rafraichissement ?? "", next: next ?? "",
  });
  // `redirect: manual` : on veut LIRE la redirection, pas la suivre. C'est elle qu'on teste.
  const r = await fetch(`${CONNECT}/auth/app`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps.toString(),
    redirect: "manual",
  });
  return { code: r.status, vers: r.headers.get("location") ?? "", cookies: r.headers.get("set-cookie") ?? "" };
}

const co = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: COMPTE, password: MDP }),
});
const s = await co.json();
if (!s.access_token) {
  console.log("❌ connexion impossible :", s.error_description || s.msg);
  process.exit(1);
}

// 1. Une vraie session ouvre la page demandée.
const bon = await remettre(s.access_token, s.refresh_token, "/commandes");
t("une vraie session est acceptée", bon.code === 303, `HTTP ${bon.code}`);
t("elle arrive sur la page demandée", bon.vers.endsWith("/commandes"), bon.vers);
t("un cookie de session est posé", /sb-|supabase/i.test(bon.cookies), bon.cookies.slice(0, 60));

// 2. Des jetons inventés n'ouvrent rien.
const faux = await remettre("faux.jeton.invente", "faux.rafraichissement", "/commandes");
t("des jetons inventés sont refusés", faux.vers.includes("/auth/login"), faux.vers);

// 3. Un corps vide ne mène qu'à la connexion.
const vide = await remettre("", "", "/commandes");
t("un appel sans jeton renvoie à la connexion", vide.vers.includes("/auth/login"), vide.vers);

// 4. Le « next » ne peut pas sortir du site.
for (const hostile of ["https://exemple-mechant.test/vol", "//exemple-mechant.test/vol"]) {
  const d = await remettre(s.access_token, s.refresh_token, hostile);
  t(`« next » hors du site est ignoré (${hostile.slice(0, 26)})`,
    d.vers.startsWith(CONNECT) && !d.vers.includes("mechant"), d.vers);
}

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
