// Fige l'identite du build dans un fichier source, AVANT la compilation.
//
// Pourquoi ce detour plutot que `env: { NEXT_PUBLIC_BUILD_DATE: new Date() }` dans next.config :
// cette valeur-la n'est figee que pour le navigateur. Le serveur relit next.config a l'execution et
// reevalue `new Date()` a chaque rendu. Le serveur ecrivait donc 16:24 et le client 16:25, et React
// jetait tout le document rendu par le serveur (erreur #425) sur chaque page.
//
// Ecrit dans un fichier, l'horodatage est la MEME constante des deux cotes.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const contenu = `// Genere par scripts/figer-build.mjs a chaque build. Ne pas modifier a la main.
export const BUILD_COMMIT: string = ${JSON.stringify((process.env.COMMIT_REF || "local").slice(0, 7))};
export const BUILD_CONTEXT: string = ${JSON.stringify(process.env.CONTEXT || "local")};
export const BUILD_DATE: string = ${JSON.stringify(new Date().toISOString())};
`;
writeFileSync(join(racine, "src", "lib", "build-info.ts"), contenu);
console.log("identite du build figee :", contenu.split("\n")[3]);
