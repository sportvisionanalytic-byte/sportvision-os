// Ce que recoit reellement la boite mail du client.
//
// Trois defauts trouves lors de l'audit de pre-production, verifies ici sur les 12 gabarits
// reellement actifs en production (exportes dans emails-gabarits.json) :
//   1. les variables etaient interpolees sans echappement, alors que certaines viennent de ce
//      qu'un client a tape (le prenom saisi au moment du paiement) ;
//   2. Brevo recevait un fragment nu, sans doctype ni viewport : rendu a la largeur d'un bureau
//      sur telephone, et fond sombre porte par un simple <div> facile a perdre ;
//   3. aucune version texte n'etait envoyee, ce que les filtres anti-spam penalisent et qui rend
//      l'e-mail vide pour qui lit ses messages en texte.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../supabase/functions/dispatch-notifications/index.ts", import.meta.url).pathname, "utf8");
const gabarits = JSON.parse(readFileSync(new URL("./emails-gabarits.json", import.meta.url).pathname, "utf8"));

// On extrait les fonctions telles qu'elles sont livrees, pour tester le code reel.
function extraire(nom) {
  const i = src.indexOf(`function ${nom}(`);
  if (i === -1) throw new Error(`introuvable : ${nom}`);
  // On ferme d'abord la liste des parametres. Compter les accolades des le debut prendrait un
  // parametre destructure (`{ escape = false }`) pour le corps de la fonction, et l'extraction
  // s'arreterait avant la premiere ligne de code.
  let k = src.indexOf("(", i), par = 0;
  for (; k < src.length; k++) {
    if (src[k] === "(") par++;
    else if (src[k] === ")" && --par === 0) break;
  }
  const debutCorps = src.indexOf("{", k);
  let p = 0;
  for (let j = debutCorps; j < src.length; j++) {
    if (src[j] === "{") p++;
    else if (src[j] === "}" && --p === 0) return src.slice(i, j + 1);
  }
  throw new Error(`fin introuvable : ${nom}`);
}
// Le fichier est en TypeScript : on le transpile avec le vrai compilateur plutot que de retirer
// les annotations a coups d'expressions regulieres, qui laisseraient passer la premiere forme
// imprevue et feraient echouer le test pour une raison sans rapport avec ce qu'il verifie.
const ts = (await import("../../SportVision-Connect/app-next/node_modules/typescript/lib/typescript.js")).default;
const js = ts.transpileModule(
  ["escHtml", "renderTemplate", "documentHtml", "versionTexte"].map(extraire).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
).outputText;
const { escHtml, renderTemplate, documentHtml, versionTexte } = new Function(
  js + "\nreturn {escHtml,renderTemplate,documentHtml,versionTexte};",
)();

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

// Valeurs hostiles la ou un client peut ecrire, valeurs plausibles ailleurs.
// Deux jeux de valeurs, parce que les deux moities du contrat ne se verifient pas ensemble :
// avec un prenom qui contient de vrais chevrons, la version texte les restitue en clair (c'est
// correct, c'est le nom de la personne) et on ne pourrait plus distinguer une balise oubliee
// d'un chevron legitime. Le jeu hostile sert donc a verifier le HTML, le jeu realiste la
// version texte.
const hostile = (v) =>
  /url|lien/i.test(v) ? "https://sportvision-an.fr/g/a?t=1&u=2"
  : /prenom|first_name|name/i.test(v) ? '<script>alert(1)</script>Camille "O\'Neil"'
  : /montant/i.test(v) ? "4,00 €"
  : /album|titre|libelle|plan/i.test(v) ? "U15 A <b>vs</b> Sens"
  : "valeur";
const realiste = (v) =>
  /url|lien/i.test(v) ? "https://sportvision-an.fr/g/a?t=1&u=2"
  : /prenom|first_name|name/i.test(v) ? "Camille"
  : /montant/i.test(v) ? "4,00 €"
  : /date|expires|echeance|changed/i.test(v) ? "8 septembre 2026"
  : "U15 A contre Sens";

console.log(`\n1. Les 12 gabarits actifs, rendus avec des valeurs hostiles`);
for (const g of gabarits) {
  const nomsVars = g.required_variables || [];
  const varsH = Object.fromEntries(nomsVars.map((v) => [v, hostile(v)]));
  const varsR = Object.fromEntries(nomsVars.map((v) => [v, realiste(v)]));
  const corpsH = renderTemplate(g.body_html_template, varsH, { escape: true });
  const html = documentHtml(corpsH, renderTemplate(g.subject_template, varsH));
  const corpsR = renderTemplate(g.body_html_template, varsR, { escape: true });
  const texte = versionTexte(corpsR);

  const pbs = [];
  // Rien de ce qu'un client a tape ne doit devenir du balisage.
  if (/<script/i.test(html)) pbs.push("script injecte");
  if (corpsH.includes("<b>vs</b>")) pbs.push("HTML d'une variable interprete");
  if (/\{\{/.test(corpsH)) pbs.push("variable non remplacee");
  if (!/^<!DOCTYPE html>/.test(html)) pbs.push("pas de doctype");
  if (!/name="viewport"/.test(html)) pbs.push("pas de viewport");
  if (!/<body[^>]*background:#09081a/.test(html)) pbs.push("fond absent du body");
  // La version texte doit rester lisible et complete.
  if (texte.length < 40) pbs.push("version texte trop courte");
  if (/<[a-z]/i.test(texte)) pbs.push("balises restantes dans la version texte");
  if (/&(amp|lt|gt|quot|#39);/.test(texte)) pbs.push("entites HTML restantes dans la version texte");
  const liens = [...g.body_html_template.matchAll(/href="\{\{(\w+)\}\}"/g)].map((m) => m[1]);
  for (const l of liens) if (!texte.includes(varsR[l])) pbs.push(`lien ${l} perdu en version texte`);

  t(g.template_key.padEnd(30), pbs.length === 0, pbs.join(", "));
}

console.log("\n2. L'echappement, en detail");
t("les chevrons sont neutralises", escHtml("<script>") === "&lt;script&gt;");
t("les guillemets aussi (attributs)", escHtml('a"b') === "a&quot;b");
t("& devient &amp;, ce qui rend une URL a plusieurs parametres correcte",
  renderTemplate('<a href="{{u}}">x</a>', { u: "https://x.fr/?a=1&b=2" }, { escape: true })
  === '<a href="https://x.fr/?a=1&amp;b=2">x</a>');
t("le sujet n'est PAS echappe (il n'est pas du HTML)",
  renderTemplate("Commande de {{n}}", { n: "Camille O'Neil" }) === "Commande de Camille O'Neil");
t("une variable absente donne du vide, pas « undefined »",
  renderTemplate("a{{manquante}}b", {}, { escape: true }) === "ab");

console.log("\n3. La version texte reste utilisable");
const ex = versionTexte(
  '<div><h1>Merci Camille&#39;!</h1><p>Votre commande est prête.</p><a href="https://sv.fr/g/abc">Voir mes photos</a><p>Fin.</p></div>',
);
t("le libelle du bouton et son lien sont conserves", ex.includes("Voir mes photos : https://sv.fr/g/abc"), ex);
t("les entites sont rendues lisibles", ex.includes("Camille'"), ex);
t("aucune balise ne subsiste", !/<[a-z]/i.test(ex));

console.log("\n4. La fonction d'envoi transmet bien les deux versions");
t("textContent est envoye a Brevo", /textContent:\s*text/.test(src));
t("htmlContent recoit le document complet", /htmlContent:\s*html/.test(src) && /const html = documentHtml\(/.test(src));
t("le corps est rendu avec echappement", /renderTemplate\(tv\.body_html_template, vars, \{ escape: true \}\)/.test(src));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
