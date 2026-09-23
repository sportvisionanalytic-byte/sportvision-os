// Aucun lien du site ne doit mener nulle part (23/09/2026).
//
// Trouvé par l'audit du 23/09 : la page d'erreur 404 proposait « Questions fréquentes » vers
// /faq.html, qui n'existe pas. Un visiteur déjà perdu tombait donc sur une deuxième page
// d'erreur. Personne ne l'avait vu, parce que personne ne visite volontairement une page 404.
//
// Ce test parcourt toutes les pages, suit chaque lien interne, et vérifie qu'il aboutit sur un
// fichier réel. Il tourne sans réseau : ce sont les fichiers du dépôt qui répondent, donc il
// attrape le problème avant le déploiement, pas après.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const site = join(ici, "..", "..", "SportVision");

const pages = readdirSync(site).filter((f) => f.endsWith(".html"));
const morts = [];

for (const page of pages) {
  const html = readFileSync(join(site, page), "utf8");
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const brut = m[1];

    // On ne juge que les liens internes : le reste appartient à d'autres serveurs.
    if (/^(https?:|mailto:|tel:|javascript:|data:|#)/.test(brut)) continue;

    // On enlève l'ancre et les paramètres : ils ne décident pas du fichier servi.
    const chemin = brut.split("#")[0].split("?")[0];
    if (!chemin) continue;

    // Un chemin absolu part de la racine du site, un chemin relatif du dossier courant —
    // ici les deux reviennent au même, le site est plat.
    let cible = chemin.replace(/^\//, "");
    if (cible === "" || cible.endsWith("/")) cible += "index.html";

    // Netlify sert /confidentialite comme confidentialite.html : c'est une règle du site, pas
    // une approximation, et les deux formes doivent donc être acceptées.
    const existe = existsSync(join(site, cible))
      || existsSync(join(site, cible + ".html"))
      || existsSync(join(site, cible, "index.html"));

    if (!existe) morts.push(`${page} → ${brut}`);
  }
}

if (morts.length === 0) {
  console.log(`✅ ${pages.length} pages parcourues, aucun lien interne mort`);
  process.exit(0);
}
console.log(`❌ ${morts.length} lien(s) interne(s) mort(s) :`);
for (const l of morts) console.log("   " + l);
process.exit(1);
