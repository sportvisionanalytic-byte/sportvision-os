// Écrit le marqueur de version lu par SportVision OS.
//
// Sans lui, personne ne peut répondre à « je ne vois pas le nouveau bouton » autrement qu'en
// devinant. Netlify expose le commit et la date au moment du build : on les fige dans un fichier
// que l'interface affiche discrètement.
//
// COMMIT_REF est fourni par Netlify. En local il est absent : on écrit alors « local », ce qui est
// exactement l'information utile (« tu regardes ta copie de travail, pas la production »).
import { writeFileSync, mkdirSync } from "node:fs";

const cible = "livrables/SportVision-TV/version.json";
mkdirSync("livrables/SportVision-TV", { recursive: true });

writeFileSync(cible, JSON.stringify({
  commit: (process.env.COMMIT_REF || "local").slice(0, 7),
  branche: process.env.BRANCH || "local",
  // Contexte Netlify : "production", "deploy-preview", "branch-deploy". Permet de repérer
  // immédiatement quelqu'un qui teste une préversion en croyant être en production.
  contexte: process.env.CONTEXT || "local",
  date: new Date().toISOString(),
}, null, 2) + "\n");

console.log("version.json écrit :", process.env.COMMIT_REF?.slice(0, 7) || "local");
