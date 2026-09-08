// Copie le worker de pdf.js dans public/ avant chaque build.
//
// Il n'est PAS versionné : le copier depuis node_modules garantit qu'il correspond exactement à la
// version de pdfjs-dist installée. Un worker désynchronisé de sa bibliothèque échoue au chargement
// du premier PDF, en production, sans rien dire au build.

import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const racine = dirname(require.resolve("pdfjs-dist/package.json"));
const source = join(racine, "build", "pdf.worker.min.mjs");
const cible = join(process.cwd(), "public", "pdf.worker.min.mjs");

await mkdir(dirname(cible), { recursive: true });
await copyFile(source, cible);
console.log(`worker pdf.js copié : ${source} → ${cible}`);
