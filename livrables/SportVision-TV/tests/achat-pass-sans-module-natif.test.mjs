// Un build sans le module natif d'achat ne doit RIEN casser.
//
// POURQUOI CE TEST EXISTE (26/09/2026)
//
// `runtimeVersion` de l'application suit la politique `appVersion`. Tant que la version affichee
// reste 1.0.0, tous les builds la partagent — y compris ceux d'avant l'ajout de expo-iap. Une mise
// a jour a distance atteint donc AUSSI un build sans le module natif.
//
// Avec un import statique, `import * as IAP from "expo-iap"` est evalue au chargement du fichier,
// donc AVANT tout garde-fou : l'ecran des galeries tombe chez quelqu'un qui n'a rien demande, et
// qui voulait juste regarder les photos de son enfant. Le chargement a la demande fait que l'echec
// d'import se traite comme « le magasin est injoignable » : aucun bouton, et le reste fonctionne.
//
// Ce test verifie les DEUX choses : que le fichier ne contient plus d'import statique du module, et
// que le motif de chargement a la demande avale bien un import qui echoue.
//
// Lancer : node livrables/SportVision-TV/tests/achat-pass-sans-module-natif.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const source = join(ici, "..", "..", "SportVision-App", "src", "lib", "achat-pass.ts");

let echecs = 0;
const verifier = (nom, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "KO  "} ${nom}${detail ? " — " + detail : ""}`);
  if (!ok) echecs++;
};

const code = readFileSync(source, "utf8");

// 1. Aucun import statique du module natif, sous aucune forme.
const importsStatiques = code.match(/^\s*import\s[^\n]*["']expo-iap["']/gm) ?? [];
verifier(
  "aucun import statique de expo-iap",
  importsStatiques.length === 0,
  importsStatiques.length ? importsStatiques.join(" | ") : "",
);

// 2. Le chargement a la demande est bien la, et entoure d'un try/catch.
verifier("le module est charge a la demande", /await import\(["']expo-iap["']\)/.test(code));
const bloc = code.match(/async function iap\(\)[\s\S]{0,400}?\n\}/)?.[0] ?? "";
verifier(
  "l'echec d'import est attrape et rend null",
  /try\s*\{/.test(bloc) && /catch\s*\{[\s\S]*?return null;/.test(bloc),
);

// 3. Le motif lui-meme : un import qui echoue ne doit pas propager.
let attrape = false;
let _m = null;
const charger = async () => {
  if (_m) return _m;
  try { _m = await import("expo-iap-qui-n-existe-pas"); return _m; }
  catch { attrape = true; return null; }
};
const m = await charger();
verifier("un import introuvable rend null sans lever", m === null && attrape);

// 4. Et la consequence attendue en bout de chaine : pas de bouton, pas d'exception.
let connecte = false;
const connexion = async () => {
  if (connecte) return true;
  const mod = await charger();
  if (!mod) return false;
  try { await mod.initConnection(); connecte = true; return true; } catch { return false; }
};
const propose = (await connexion()) ? { bouton: true } : null;
verifier("aucun Pass propose quand le module manque", propose === null);

console.log(echecs ? `\nROUGE : ${echecs} verification(s) en echec.` : "\nVERT : tout est bon.");
process.exit(echecs ? 1 : 0);
