// L'application doit offrir ce que le site offre (25/09/2026).
//
// DEMANDE DE FOUKA : « je veux quasiment tout pareil, juste avec l'interface qu'il y a là ».
// Le vrai risque n'est pas l'écart d'aujourd'hui, qui se rattrape en une journée. C'est celui de
// dans trois mois : une page ajoutée à Connect, personne ne pense à l'application, et l'écart se
// creuse sans que rien ne le signale. Ce test le signale.
//
// LA RÉFÉRENCE, ce sont les trois menus de Connect — /medias, /mon-univers, /services — plus le
// compte. Ce ne sont pas des listes que j'invente : ce sont les fichiers du site, lus ici
// directement. Si quelqu'un ajoute une tuile à l'un de ces menus, ce test échoue tant que
// l'application ne l'a pas.
//
// CE QUE LE TEST N'EXIGE PAS. Que l'écran soit écrit en natif. Une page ouverte dans une fenêtre,
// avec la session déjà faite, compte comme couverte : ce qui importe est qu'une famille puisse
// le faire depuis l'application, pas la technique employée.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..", "..");
const CONNECT = join(racine, "SportVision-Connect", "app-connect", "src", "app", "(joueur)");
const APP = join(racine, "SportVision-App");

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

/** Les destinations listées dans un menu de Connect. */
function tuiles(menu) {
  const src = readFileSync(join(CONNECT, menu, "page.tsx"), "utf8");
  return [...src.matchAll(/href:\s*"(\/[a-z-]+)"/g)].map((m) => m[1]);
}

const attendues = new Set([
  ...tuiles("medias"),
  ...tuiles("mon-univers"),
  ...tuiles("services"),
  // Le compte n'a pas de menu dédié : ses entrées vivent dans la barre latérale.
  "/profil", "/acces", "/reconnaissance",
]);

// Ce que l'application sait atteindre : les chemins déclarés dans son catalogue Connect, plus
// ceux qu'elle rend elle-même en natif.
const catalogue = readFileSync(join(APP, "src", "lib", "connect.ts"), "utf8");
const parFenetre = [...catalogue.matchAll(/chemin:\s*"(\/[a-z-]+)"/g)].map((m) => m[1]);

// Les écrans natifs, reconnus par la route qu'ils couvrent côté site.
const NATIFS = {
  "/calendrier": "app/(app)/calendrier.tsx",
  "/photos": "app/(app)/photos.tsx",
  "/dashboard": "app/(app)/accueil.tsx",
};
const enNatif = Object.entries(NATIFS)
  .filter(([, f]) => { try { readFileSync(join(APP, f)); return true; } catch { return false; } })
  .map(([chemin]) => chemin);

const couvertes = new Set([...parFenetre, ...enNatif]);

console.log(`Connect expose ${attendues.size} destinations, l'application en couvre ${couvertes.size}.\n`);

for (const chemin of [...attendues].sort()) {
  t(`« ${chemin} » est atteignable depuis l'application`, couvertes.has(chemin));
}

// L'inverse compte aussi : un chemin que l'application ouvre mais que le site n'expose plus
// mènerait à une page morte, et personne ne s'en apercevrait avant une famille.
// Les ecrans ne vivent pas tous sous « (joueur) » : /galeries et /aide sont a la racine, parce
// qu'ils servent aussi a d'autres espaces. On regarde donc les deux endroits — un test trop
// etroit qui crie au lien mort alors que la page existe finit par etre ignore, et le jour ou il
// a raison personne ne l'ecoute.
const pagesDuSite = new Set([
  ...readdirSync(CONNECT, { withFileTypes: true }),
  ...readdirSync(join(CONNECT, ".."), { withFileTypes: true }),
]
  .filter((d) => d.isDirectory() && !d.name.startsWith("(") && !d.name.startsWith("_"))
  .map((d) => "/" + d.name));
for (const chemin of parFenetre) {
  t(`« ${chemin} » existe encore sur le site`, pagesDuSite.has(chemin));
}

// Le mot « accès » a désigné deux choses différentes : sur le site, qui peut voir mon profil ;
// dans l'application, comment obtenir ses photos. La confusion a été levée en renommant l'écran
// de l'application. Qu'elle ne revienne pas.
let collision = false;
try { readFileSync(join(APP, "app", "(app)", "acces.tsx")); collision = true; } catch { /* absent, tant mieux */ }
t("aucun écran de l'application ne s'appelle « acces » (le site l'utilise pour autre chose)",
  !collision);

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
