// Le Responsable Production peut livrer SES propres photos.
//
// CE QUI A RENDU CE TEST NÉCESSAIRE (27/09/2026). Fouka, rapportant Mikael : « dans son espace, il
// se voit que en tant que responsable production, mais il ne peut pas livrer ses photos, il ne peut
// pas faire ses livrables ». Il est les deux à la fois : il encadre le pôle Football ET il est
// affecté sur le terrain — 4 missions acceptées, mesuré en base.
//
// LE DÉFAUT N'ÉTAIT PAS DANS LES DROITS. `media_liens` accepte déjà un `prod` de ce pôle
// (ml_write : is_staff() et prestation_pole_scope_ok), et le dépôt d'un lien ne teste aucun rôle. Ce
// qui manquait, c'était la NAVIGATION : « Missions » et « Livraisons » de NAV.prod sont les écrans
// d'ENCADREMENT (les missions du pôle, les livrables des autres à relire). Rien ne montrait ses
// missions à lui.
//
// ON VÉRIFIE LES TROIS PIÈCES, parce qu'il en manque une et l'écran reste vide ou blanc :
//   1. les deux entrées dans NAV.prod ;
//   2. les gabarits, alias des écrans du rôle photo sous des identifiants distincts ;
//   3. le répartiteur, qui appelle les chargeurs pour le rôle prod.
//
// LES COMMENTAIRES SONT RETIRÉS AVANT TOUTE RECHERCHE. Le 26/09, un test de ce dossier est resté
// VERT après suppression du code qu'il surveillait : il trouvait son propre commentaire explicatif.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const brut = readFileSync(join(ici, "..", "SportVision-OS-Full.html"), "utf8");

// Retirer les commentaires de ligne et de bloc : on ne cherche que du code.
const src = brut
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
  .join("\n");

let ko = 0;
const t = (nom, ok, detail = "") => {
  if (ok) console.log(`  ok   ${nom}`);
  else { ko++; console.log(`  KO   ${nom}${detail ? "\n       " + detail : ""}`); }
};

// ── 1. LA NAVIGATION ────────────────────────────────────────────────────────────────────────────
const debutProd = src.indexOf("\n  prod:[");
const navProd = debutProd < 0 ? "" : src.slice(debutProd, src.indexOf("\n  photo:[", debutProd));
t("NAV.prod existe", navProd.length > 0);
t("NAV.prod propose « Mes missions » terrain", /\{id:'terrainpre'/.test(navProd),
  "sans cette entree, le Responsable Production ne voit jamais ses propres missions");
t("NAV.prod propose « Mes livrables »", /\{id:'terrainmedias'/.test(navProd),
  "sans cette entree, il ne peut pas deposer ses liens");

// Et les ecrans d'encadrement ne doivent pas avoir ete remplaces au passage.
t("« Missions » (encadrement du pole) est toujours la", /\{id:'pre'/.test(navProd));
t("« Livraisons » (relecture des autres) est toujours la", /\{id:'livr'/.test(navProd));

// ── 2. LES GABARITS ────────────────────────────────────────────────────────────────────────────
t("le gabarit prod.terrainpre est defini",
  /VIEWS\['prod\.terrainpre'\]\s*=\s*VIEWS\['photo\.pre'\]/.test(src),
  "l'entree de menu existerait sans ecran derriere : page blanche");
t("le gabarit prod.terrainmedias est defini",
  /VIEWS\['prod\.terrainmedias'\]\s*=\s*VIEWS\['photo\.medias'\]/.test(src));
// Les cles doivent etre DISTINCTES de celles de l'encadrement, sinon on ecrase ses ecrans de chef.
t("prod.pre et prod.media ne sont pas ecrases",
  !/VIEWS\['prod\.pre'\]\s*=\s*VIEWS\['photo\./.test(src)
  && !/VIEWS\['prod\.media'\]\s*=\s*VIEWS\['photo\./.test(src));

// ── 3. LE REPARTITEUR ──────────────────────────────────────────────────────────────────────────
t("le repartiteur charge ses missions",
  /role===['"]prod['"]&&view===['"]terrainpre['"]\)\s*await\s+loadPhotoMesPrestations\(\)/.test(src.replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " ")).replace(/ /g, "")) ||
  /role===['"]prod['"]\s*&&\s*view===['"]terrainpre['"]\s*\)\s*await\s+loadPhotoMesPrestations\(\)/.test(src),
  "l'ecran s'afficherait vide : le gabarit est rendu mais rien ne le remplit");
t("le repartiteur charge ses livrables",
  /role===['"]prod['"]\s*&&\s*view===['"]terrainmedias['"]\s*\)\s*await\s+loadPhotoMedias\(\)/.test(src));

// ── 4. LES CHARGEURS RESTENT BORNES A SES PROPRES MISSIONS ─────────────────────────────────────
//
// C'est ce qui rend l'operation sans risque : on reutilise les ecrans de l'operateur PARCE QU'ILS
// filtrent sur collaborateur_id = soi. Si ce filtre disparaissait, le Responsable Production
// verrait les missions et les liens de toute son equipe dans un ecran intitule « Mes missions ».
for (const nom of ["loadPhotoMesPrestations", "loadPhotoMedias"]) {
  const i = src.indexOf(`async function ${nom}`);
  const corps = i < 0 ? "" : src.slice(i, i + 3000);
  t(`${nom} filtre sur ses propres affectations`,
    /collaborateur_id=eq\.'\+(S\.uid|uid)/.test(corps),
    "l'ecran « Mes missions » montrerait celles des autres");
}

console.log(ko === 0 ? "\nTout est vert." : `\n${ko} verification(s) en echec.`);
process.exit(ko === 0 ? 0 : 1);
