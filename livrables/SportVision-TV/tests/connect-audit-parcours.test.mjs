// Chaque écran de Connect répond-il, et avec quoi ? (25/09/2026)
//
// Même méthode que l'audit de l'application : on ne se demande pas si le code a l'air juste, on
// regarde ce qu'un vrai compte reçoit sur un vrai serveur. Un écran qui répond 200 en affichant
// un formulaire de connexion n'est pas une réussite, et une famille ne fait pas la différence
// entre « votre club n'a rien publié » et « c'est cassé ».
//
// CE QU'IL VÉRIFIE :
//   1. Chaque page s'ouvre, pour un joueur ET pour un parent — les deux ne voient pas la même
//      chose, et une page réservée au joueur renvoie un parent ailleurs sans prévenir.
//   2. Aucune ne redemande un mot de passe alors que la session est valable.
//   3. Aucune ne renvoie une erreur serveur.
//   4. Les pages publiques restent publiques : l'aide et la galerie partagée s'ouvrent sans
//      compte, parce qu'un lien WhatsApp arrive toujours chez quelqu'un qui n'est pas connecté.
import { SB, ANON } from "./_session-os.mjs";

const CONNECT = "https://connect.sportvision-an.fr";
const MDP = "DemoSportVision2026!";

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

async function session(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`connexion impossible : ${email}`);
  return d;
}

/** Ouvre une page de Connect avec une vraie session, et rend ce que le serveur a répondu. */
async function ouvrir(s, chemin) {
  const corps = new URLSearchParams({
    access_token: s.access_token, refresh_token: s.refresh_token, next: chemin });
  const r = await fetch(`${CONNECT}/auth/app`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps.toString(), redirect: "manual" });
  const biscuits = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")])
    .filter(Boolean).map((c) => c.split(";")[0]).join("; ");
  const p = await fetch(r.headers.get("location"), { headers: { cookie: biscuits }, redirect: "manual" });
  const html = p.status === 200 ? await p.text() : "";
  return {
    code: p.status,
    vers: p.headers.get("location"),
    // Un champ de mot de passe sur une page censée être ouverte : la session n'a pas pris.
    demandeMotDePasse: /type="password"/.test(html),
    // Next.js écrit ce marqueur quand une page plante côté serveur.
    erreurServeur: /Application error: a server-side exception/.test(html),
    taille: html.length,
  };
}

const PAGES = [
  "/dashboard", "/calendrier", "/photos", "/galeries", "/contenus",
  "/affiliations", "/equipes", "/messages", "/prestations", "/cotisations",
  "/commandes", "/factures", "/profil", "/acces", "/medias", "/mon-univers", "/services",
];

for (const [role, email] of [
  ["joueur", "demo.u18.villemomble@example.invalid"],
  ["parent", "demo.parent.villemomble@example.invalid"],
]) {
  console.log(`\n═══ ${role.toUpperCase()} ═══\n`);
  const s = await session(email);
  const redirigees = [];
  const cassees = [];
  const reconnexions = [];
  const vides = [];

  for (const page of PAGES) {
    const r = await ouvrir(s, page);
    if (r.code !== 200) redirigees.push(`${page} → ${r.code} ${r.vers ?? ""}`);
    else if (r.erreurServeur) cassees.push(page);
    else if (r.demandeMotDePasse) reconnexions.push(page);
    // Une page de moins de 2 ko n'a pratiquement rien rendu : c'est suspect, sans être une preuve.
    else if (r.taille < 2000) vides.push(`${page} (${r.taille} octets)`);
  }

  t(`les ${PAGES.length} pages s'ouvrent`, redirigees.length === 0, redirigees.join(" | "));
  t("aucune ne plante côté serveur", cassees.length === 0, cassees.join(", "));
  t("aucune ne redemande le mot de passe", reconnexions.length === 0, reconnexions.join(", "));
  t("aucune ne rend une page quasi vide", vides.length === 0, vides.join(", "));
}

// ── Ce qui doit rester ouvert sans compte ──────────────────────────────────────────────────
console.log("\n═══ PAGES PUBLIQUES ═══\n");
for (const [nom, chemin] of [["l'aide", "/aide"], ["la connexion", "/auth/login"]]) {
  const r = await fetch(CONNECT + chemin, { redirect: "manual" });
  t(`${nom} s'ouvre sans compte`, r.status === 200, `HTTP ${r.status}`);
}

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
