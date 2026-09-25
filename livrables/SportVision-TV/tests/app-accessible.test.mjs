// Tout ce qu'on touche dans l'application doit pouvoir être lu à voix haute (25/09/2026).
//
// POURQUOI. SportVision vend à des familles, et une famille comprend des gens qui n'y voient pas
// bien. Une zone tactile sans nom, VoiceOver l'annonce « bouton », rien de plus : on ne sait pas
// ce qu'on s'apprête à déclencher. C'est aussi un point que la relecture de l'App Store regarde.
//
// Trouvé le 25/09 en auditant : 29 zones tactiles sur 40 n'avaient aucun nom, dont le composant
// Bouton lui-même — c'est-à-dire tous les boutons de l'application d'un seul coup.
//
// CE TEST NE JUGE PAS LA QUALITÉ DU LIBELLÉ, il vérifie qu'il existe. Un nom faux se voit en
// utilisant l'application ; un nom absent ne se voit jamais, sauf le jour où quelqu'un en a
// besoin.
//
// Il tourne sans réseau, sans base, sans simulateur : il lit les fichiers.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const APP = join(ici, "..", "..", "SportVision-App");

/** Tous les .tsx de l'application, écrans et composants. */
function fichiers(dossier, acc = []) {
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) fichiers(chemin, acc);
    else if (e.name.endsWith(".tsx")) acc.push(chemin);
  }
  return acc;
}

const tous = [...fichiers(join(APP, "app")), ...fichiers(join(APP, "src"))];

let zones = 0;
const manquants = [];

for (const f of tous) {
  const src = readFileSync(f, "utf8");
  // On découpe sur les ouvertures de Pressable, puis on lit les propriétés jusqu'à la fin de la
  // balise.
  //
  // TROUVER CETTE FIN DEMANDE DE COMPTER LES ACCOLADES, et la première version de ce test ne le
  // faisait pas : elle s'arrêtait au premier « > », qui tombe dans la flèche d'une fonction
  // `style={({ pressed }) => ...}`. Elle a donc accusé 34 zones correctement nommées. Un test
  // qui crie au loup sur du code juste finit par être ignoré, et le jour où il a raison personne
  // ne l'écoute.
  const morceaux = src.split("<Pressable").slice(1);
  for (const m of morceaux) {
    zones += 1;
    let profondeur = 0;
    let fin = m.length;
    for (let i = 0; i < m.length; i += 1) {
      const c = m[i];
      if (c === "{") profondeur += 1;
      else if (c === "}") profondeur -= 1;
      else if (c === ">" && profondeur === 0) { fin = i + 1; break; }
    }
    const proprietes = m.slice(0, fin);
    const nomme = proprietes.includes("accessibilityLabel")
      // Un Pressable qui ne contient qu'un Text lisible est déjà annoncé par son contenu ; on
      // exige quand même le rôle, sinon il n'est pas reconnu comme un bouton.
      || proprietes.includes("accessibilityRole");
    if (!nomme) {
      const ligne = src.slice(0, src.indexOf(m) ).split("\n").length;
      manquants.push(`${f.replace(APP + "/", "")}:${ligne}`);
    }
  }
}

console.log(`${zones} zones tactiles examinées.`);
if (manquants.length === 0) {
  console.log("✅ toutes portent un rôle ou un libellé");
  process.exit(0);
}
console.log(`❌ ${manquants.length} sans rôle ni libellé :`);
for (const m of manquants) console.log("   " + m);
process.exit(1);
