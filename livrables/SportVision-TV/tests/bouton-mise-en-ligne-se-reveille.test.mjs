// Le bouton « Mettre la galerie en ligne » doit se réveiller tout seul quand les photos arrivent.
//
// CE QUE CE TEST PROTÈGE, ET POURQUOI IL EST STATIQUE
//
// Fouka, trois fois de suite : « je dois décocher, recocher pour pouvoir mettre en ligne la galerie
// alors que les photos ont fini de se télécharger ». La cause tenait en une ligne absente :
// `_galRendreFinal()` calcule l'état du bouton (désactivé tant qu'aucune photo n'est prête) et
// n'était pas rappelée par `_galChargerAssets()`, le point par lequel passent tous les changements
// du nombre de photos. Le bouton gardait donc l'état d'une galerie vide, et seul un aller-retour sur
// la case « Galerie gratuite » le réveillait.
//
// Ce défaut ne se voit pas en lisant les deux fonctions séparément : chacune est correcte, c'est le
// LIEN qui manquait. Et il ne se voit pas non plus dans un test de base de données — il est
// entièrement dans le navigateur. D'où un contrôle statique sur le fichier : il coûte une seconde,
// et il attrape la seule chose qui compte.
//
// Lancer : node livrables/SportVision-TV/tests/bouton-mise-en-ligne-se-reveille.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const os = readFileSync(join(ici, "..", "SportVision-OS-Full.html"), "utf8");

let echecs = 0;
const verifier = (nom, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "KO  "} ${nom}${detail ? " — " + detail : ""}`);
  if (!ok) echecs++;
};

/**
 * Le corps d'une fonction nommée, SANS SES COMMENTAIRES.
 *
 * Retirer les commentaires n'est pas un détail de confort : la première version de ce test est
 * restée VERTE alors que j'avais supprimé l'appel, parce que le commentaire laissé au-dessus
 * contenait le mot `_galRendreFinal()`. Un test qui lit les commentaires valide l'intention au lieu
 * du code — c'est-à-dire exactement ce qu'un test ne doit jamais faire.
 */
function corps(nom) {
  const i = os.indexOf(`async function ${nom}(`) >= 0
    ? os.indexOf(`async function ${nom}(`)
    : os.indexOf(`function ${nom}(`);
  if (i < 0) return null;
  const j = os.indexOf("\n}\n", i);
  if (j < 0) return null;
  return os.slice(i, j)
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // commentaires de bloc
    .replace(/^[ \t]*\/\/.*$/gm, " ");    // commentaires de ligne
}

const chargerAssets = corps("_galChargerAssets");
verifier("_galChargerAssets existe", !!chargerAssets);

verifier(
  "la fin des envois recalcule l'état du bouton",
  !!chargerAssets && /_galRendreFinal\s*\(/.test(chargerAssets),
  chargerAssets && !/_galRendreFinal\s*\(/.test(chargerAssets)
    ? "sans cet appel, le bouton reste désactivé jusqu'à un aller-retour sur « Galerie gratuite »"
    : "",
);

// La chaîne complète : les envois terminés doivent bien passer par _galChargerAssets.
const lancerQueue = corps("_galLancerQueue");
verifier(
  "la file d'envoi appelle bien _galChargerAssets en fin de lot",
  !!lancerQueue && /_galChargerAssets\s*\(/.test(lancerQueue),
);

// Et le bouton doit toujours se désactiver sur un manque réel : le test ne doit pas passer au vert
// en supprimant la notion de « il manque quelque chose ».
const rendreFinal = corps("_galRendreFinal");
verifier(
  "le bouton reste désactivé quand il manque quelque chose",
  !!rendreFinal && /manque\.length\s*\?\s*'disabled'/.test(rendreFinal),
);

console.log(echecs ? `\nROUGE : ${echecs} vérification(s) en échec.` : "\nVERT : tout est bon.");
process.exit(echecs ? 1 : 0);
