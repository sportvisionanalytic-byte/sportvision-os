// Aucun nom global declare deux fois dans SportVision OS.
//
// POURQUOI CE TEST EXISTE. Le 09/09/2026, deux collisions ont ete introduites en une journee
// dans un fichier de 3,5 Mo :
//
//   • `PARCOURS_ETAPES` — le nom etait deja pris depuis le 22/08 par la frise de parcours
//     CLIENT. Deux `const` homonymes dans le meme script, et TOUT L'OS cesse de se charger.
//     Attrape avant deploiement, mais uniquement parce qu'une verification de syntaxe a ete
//     lancee a la main.
//   • `validerLivrable` — deja definie sur `media_livrables`, redefinie sur `media_liens`.
//     Une redefinition de fonction ne fait aucun bruit : la derniere gagne, et l'ecran
//     Livraisons se serait mis a ecrire dans la mauvaise table.
//
// Le premier casse tout bruyamment, le second casse silencieusement. Le second est le pire.
//
// Ce test relit le fichier tel qu'il est et refuse tout doublon de `const`, `let`, `function`
// ou `class` au premier niveau, plus les identifiants d'elements HTML critiques.

import { readFileSync } from "node:fs";

const chemin = new URL("../SportVision-OS-Full.html", import.meta.url).pathname;
const html = readFileSync(chemin, "utf8");

// On ne garde que le contenu des <script> : le HTML peut contenir les memes mots dans du texte.
const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const js = scripts.join("\n");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? "\n       " + detail : ""}`); }
};

console.log(`\nFichier : ${(html.length / 1048576).toFixed(2)} Mo, ${scripts.length} bloc(s) <script>`);

// ── Declarations de premier niveau ──────────────────────────────────────────
// Une declaration de premier niveau commence en debut de ligne, sans indentation : c'est ce qui
// la distingue d'une variable locale dans une fonction. Le fichier suit cette convention.
function declarations(motif) {
  const vus = new Map();
  for (const m of js.matchAll(motif)) {
    const nom = m[1];
    const ligne = js.slice(0, m.index).split("\n").length;
    if (!vus.has(nom)) vus.set(nom, []);
    vus.get(nom).push(ligne);
  }
  return vus;
}

const familles = [
  ["const / let", /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm],
  ["function",    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm],
  ["class",       /^class\s+([A-Za-z_$][\w$]*)/gm],
];

for (const [libelle, motif] of familles) {
  const vus = declarations(motif);
  const doubles = [...vus.entries()].filter(([, l]) => l.length > 1);
  t(`aucun doublon de ${libelle} au premier niveau`,
    doubles.length === 0,
    doubles.map(([n, l]) => `${n} — lignes ${l.join(", ")}`).join("\n       "));
}

// ── Collision entre familles ────────────────────────────────────────────────
// `const X` puis `function X` est une erreur de syntaxe tout aussi fatale.
const tous = new Map();
for (const [, motif] of familles) {
  for (const [nom, lignes] of declarations(motif)) {
    tous.set(nom, [...(tous.get(nom) || []), ...lignes]);
  }
}
const croises = [...tous.entries()].filter(([, l]) => l.length > 1);
t("aucun nom declare dans deux familles differentes", croises.length === 0,
  croises.map(([n, l]) => `${n} — lignes ${l.join(", ")}`).join("\n       "));

// ── Identifiants HTML critiques ─────────────────────────────────────────────
// Un id en double fait que getElementById renvoie le premier, et l'ecran ecrit au mauvais
// endroit sans aucune erreur.
//
// On ne mesure que le HTML STATIQUE : blocs <script>, commentaires HTML et commentaires CSS
// retires. Les trois produisent des faux positifs mesures le 10/09/2026 :
//   • les gabarits construits en JavaScript reutilisent legitimement les memes id d'un ecran
//     a l'autre (`pd-statut`, `dv-cli`...), car deux modales ne sont jamais ouvertes ensemble ;
//   • un commentaire qui CITE un id (« pointer-events deplace depuis <div id="sv-modal"> »)
//     n'en cree evidemment aucun.
// Sans ce filtrage, le controle signalait 79 doublons dont aucun n'existait.
const statique = html
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const ids = new Map();
for (const m of statique.matchAll(/\bid="([a-zA-Z][\w-]*)"/g)) {
  ids.set(m[1], (ids.get(m[1]) || 0) + 1);
}
const idsDoubles = [...ids.entries()].filter(([, n]) => n > 1);
t(`aucun identifiant HTML statique en double (${ids.size} id)`, idsDoubles.length === 0,
  idsDoubles.map(([n, c]) => `${n} (${c}x)`).join(", "));

// ── Le fichier reste syntaxiquement valide ──────────────────────────────────
// Garde-fou de dernier recours : c'est ce controle qui a rattrape PARCOURS_ETAPES.
let syntaxeOk = true, erreurSyntaxe = "";
try {
  new (Function.constructor)(js);
} catch (e) {
  syntaxeOk = !/SyntaxError|has already been declared/.test(String(e));
  erreurSyntaxe = String(e).split("\n")[0];
}
t("le JavaScript du fichier est syntaxiquement valide", syntaxeOk, erreurSyntaxe);

// ── Taille : garde-fou contre une suppression accidentelle ──────────────────
// Le fichier a deja perdu 5 465 lignes par accident. En dessous de 30 000 lignes, quelque chose
// a ete efface : ce n'est pas une limite arbitraire, c'est un seuil largement sous la taille
// reelle, franchi seulement en cas d'accident.
const lignes = html.split("\n").length;
t(`le fichier n'a pas fondu (${lignes} lignes)`, lignes > 30000, `seulement ${lignes} lignes`);

console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
