// La configuration de l'application mobile ne doit plus pouvoir produire un build muet ou
// refusé par un magasin (23/09/2026).
//
// Deux pannes trouvées par l'audit du 23/09, toutes deux invisibles jusqu'au jour où elles
// coûtent cher :
//
//   1. La clé publique était lue dans l'environnement avec un repli sur la chaîne vide. Une
//      compilation sans fichier .env donnait une application qui démarre, affiche ses écrans,
//      et ne charge jamais rien. Aucun message.
//   2. Le numéro de build Android était figé à 1 dans un fichier engendré par `prebuild` et
//      absent de la configuration. Au deuxième envoi, Google refuse : « version code already
//      used », et il faut tout recompiler.
//
// Ce test se lance sans réseau et sans base. Il lit des fichiers, rien de plus.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const app = join(ici, "..", "..", "SportVision-App");

let ko = 0;
const verifier = (condition, message) => {
  if (condition) console.log("✅ " + message);
  else { console.log("❌ " + message); ko += 1; }
};

const config = JSON.parse(readFileSync(join(app, "app.json"), "utf8")).expo;

// ── 1. L'adresse et la clé sont dans le fichier versionné ──────────────────────────────────
const extra = config.extra ?? {};
verifier(
  typeof extra.supabaseUrl === "string" && extra.supabaseUrl.startsWith("https://"),
  "app.json porte l'adresse de la base",
);
verifier(
  typeof extra.supabaseCle === "string" && extra.supabaseCle.length > 20,
  "app.json porte la clé publique : une compilation sans .env reste fonctionnelle",
);

// ── 2. Plus aucun repli silencieux dans le code ────────────────────────────────────────────
const config_ts = readFileSync(join(app, "src", "lib", "config.ts"), "utf8");
verifier(
  config_ts.includes("throw new Error"),
  "config.ts refuse de démarrer sans clé, au lieu de se taire",
);
const supabase_ts = readFileSync(join(app, "src", "lib", "supabase.ts"), "utf8");
verifier(
  !/process\.env\.EXPO_PUBLIC_SUPABASE_ANON_KEY\s*\?\?\s*""/.test(supabase_ts),
  "supabase.ts n'a plus de repli sur la chaîne vide",
);

// ── 3. Les numéros de version que les magasins exigent ─────────────────────────────────────
verifier(
  Number.isInteger(config.android?.versionCode),
  "app.json déclare le numéro de build Android (sinon le 2e envoi Play est refusé)",
);
verifier(
  typeof config.ios?.buildNumber === "string" && config.ios.buildNumber.length > 0,
  "app.json déclare le numéro de build iOS",
);

// ── 4. Une seule déclaration par greffon ───────────────────────────────────────────────────
// L'écran de démarrage était déclaré deux fois, une fois en texte et une fois avec ses
// réglages. Sans conséquence visible, mais le jour où les deux divergent, on cherche longtemps.
const noms = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
verifier(doublons.length === 0, `aucun greffon déclaré deux fois${doublons.length ? " (" + doublons.join(", ") + ")" : ""}`);

// ── 5. L'iPad reste exclu ──────────────────────────────────────────────────────────────────
// Apple avait refusé le premier envoi parce que le binaire se déclarait compatible iPad sans
// capture d'écran iPad. La règle tient dans un booléen, autant le surveiller.
verifier(config.ios?.supportsTablet === false, "l'application ne se déclare pas compatible iPad");

console.log(ko === 0 ? "\nTout est vert." : `\n${ko} problème(s).`);
process.exit(ko === 0 ? 0 : 1);
