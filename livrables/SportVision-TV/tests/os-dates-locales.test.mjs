// Les dates de l'OS, verifiees a l'heure ou elles cassent.
//
// L'audit du 11/08 avait remplace ~30 usages de `.toISOString().slice(0,10)` par ymdLocal, parce
// qu'une Date locale relue en UTC recule d'un jour. Quatre survivants restaient. Le piege de ce
// genre de bug est qu'il est invisible en pleine journee : a 14h, UTC et heure de Paris tombent le
// meme jour et tout semble juste. Ce test avance donc volontairement l'horloge dans la fenetre ou
// les deux divergent (minuit -> 2h l'ete, minuit -> 1h l'hiver), et compare a l'attendu.
//
// On extrait les fonctions telles qu'elles sont livrees dans SportVision-OS-Full.html : on teste le
// code reel, pas une reecriture.

import { readFileSync } from "node:fs";

if (process.env.TZ !== "Europe/Paris") {
  console.error("Ce test doit tourner en TZ=Europe/Paris (c'est le fuseau des utilisateurs).");
  process.exit(1);
}

const OS = new URL("../SportVision-OS-Full.html", import.meta.url).pathname;
const html = readFileSync(OS, "utf8");

function extract(name, kind = "function") {
  const start = kind === "const" ? html.indexOf(`const ${name}=`) : html.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`introuvable : ${name}`);
  // Une constante sans accolade (un tableau, une chaine) s'arrete au premier point-virgule : lui
  // appliquer le comptage d'accolades ci-dessous irait chercher la fonction suivante.
  if (kind === "const" && !/^const [^=]+=\s*[{[]?\s*$/.test("") && html[html.indexOf("=", start) + 1] !== "{") {
    const fin = html.indexOf(";", start);
    if (fin !== -1 && !html.slice(start, fin).includes("{")) return html.slice(start, fin + 1);
  }
  let depth = 0, seen = false;
  for (let i = start; i < html.length; i++) {
    if (html[i] === "{") { depth++; seen = true; }
    else if (html[i] === "}") {
      if (--depth === 0 && seen) {
        return kind === "const" ? html.slice(start, html.indexOf(";", i) + 1) : html.slice(start, i + 1);
      }
    }
  }
  throw new Error(`fin introuvable : ${name}`);
}

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

// ── Horloge simulee ──────────────────────────────────────────────────────────
// On remplace Date par une sous-classe dont le constructeur sans argument renvoie l'instant voulu.
// Tout le reste (setDate, getMonth, toISOString) reste le vrai comportement de Date.
const VraiDate = Date;
function figerHorloge(y, mo, d, h, mi) {
  globalThis.Date = class extends VraiDate {
    constructor(...a) { super(...(a.length ? a : [y, mo, d, h, mi, 0, 0])); }
    static now() { return new VraiDate(y, mo, d, h, mi, 0, 0).getTime(); }
  };
}
const libererHorloge = () => { globalThis.Date = VraiDate; };

// ── Chargement du code reel de l'OS ──────────────────────────────────────────
const src = [
  extract("ymdLocal"),
  extract("_MOIS_COURTS", "const"),
  extract("dateFr"),
  "let _statsPeriode='30j', _statsDebut=null, _statsFin=null;",
  extract("_statsPlage"),
  "globalThis.__os={ymdLocal,dateFr,_statsPlage,setPeriode:p=>{_statsPeriode=p}};",
].join("\n");
new Function(src)();
const os = globalThis.__os;

// ── 1. ymdLocal ne recule jamais d'un jour ───────────────────────────────────
console.log("\n1. ymdLocal — la date du jour, a toute heure");
for (const h of [0, 1, 2, 13, 23]) {
  const d = new VraiDate(2026, 8, 8, h, 30);
  t(`${String(h).padStart(2, "0")}h30 -> 2026-09-08`, os.ymdLocal(d) === "2026-09-08", os.ymdLocal(d));
}
// Et le cas historique : minuit pile, borne de mois.
t("1er sept. 00h00 -> 2026-09-01", os.ymdLocal(new VraiDate(2026, 8, 1, 0, 0)) === "2026-09-01");
t("31 dec. 23h59 -> 2026-12-31", os.ymdLocal(new VraiDate(2026, 11, 31, 23, 59)) === "2026-12-31");

// ── 2. Les bornes de periode des stats, consultees la nuit ───────────────────
console.log("\n2. Periodes de statistiques entre minuit et 2h (le bug corrige)");
const attendu = {
  "7j":     ["2026-09-02", "2026-09-08"],
  "30j":    ["2026-08-10", "2026-09-08"],
  "mois":   ["2026-09-01", "2026-09-08"],
  "mois-1": ["2026-08-01", "2026-08-31"],
};
for (const h of [0, 1, 2]) {
  figerHorloge(2026, 8, 8, h, 30);
  for (const [p, [d0, f0]] of Object.entries(attendu)) {
    os.setPeriode(p);
    const { d, f } = os._statsPlage();
    t(`${String(h).padStart(2, "0")}h30 · ${p.padEnd(6)} ${d} -> ${f}`, d === d0 && f === f0, `attendu ${d0} -> ${f0}`);
  }
}
libererHorloge();

// L'hiver aussi (UTC+1) : la fenetre est plus courte mais elle existe.
console.log("\n3. Meme verification en heure d'hiver (UTC+1)");
figerHorloge(2026, 0, 15, 0, 30);
os.setPeriode("mois");
{
  const { d, f } = os._statsPlage();
  t(`15 janv. 00h30 · mois ${d} -> ${f}`, d === "2026-01-01" && f === "2026-01-15", "attendu 2026-01-01 -> 2026-01-15");
}
libererHorloge();

// ── 4. dateFr : lisible, et sans repasser par UTC ────────────────────────────
console.log("\n4. dateFr — affichage francais d'une date stockee");
t("2026-09-08 -> 8 sept. 2026", os.dateFr("2026-09-08") === "8 sept. 2026", os.dateFr("2026-09-08"));
t("2026-01-01 -> 1 janv. 2026", os.dateFr("2026-01-01") === "1 janv. 2026", os.dateFr("2026-01-01"));
t("2026-12-31 -> 31 dec. 2026", os.dateFr("2026-12-31") === "31 dec. 2026", os.dateFr("2026-12-31"));
// dateFr lit la chaine directement au lieu de la donner a new Date(). A Paris (fuseau positif)
// new Date("2026-09-08") tombe le bon jour, donc l'ecart ne se verrait pas ici ; il apparait des
// qu'un navigateur est regle sur un fuseau negatif, ou sur un telephone en voyage. On verifie donc
// la propriete a la source : la fonction ne construit aucune Date.
t("dateFr ne passe jamais par new Date()", !/new Date/.test(extract("dateFr")));
t("valeur inattendue rendue telle quelle, jamais 'Invalid Date'", os.dateFr("n/a") === "n/a");
t("valeur vide -> chaine vide", os.dateFr("") === "" && os.dateFr(null) === "" && os.dateFr(undefined) === "");

// ── 5. Aucune regression : plus de conversion UTC sur une Date locale ────────
console.log("\n5. Le motif fautif n'est pas revenu dans le fichier");
const lignes = html.split("\n");
const restants = lignes
  .map((texte, i) => ({ n: i + 1, texte }))
  // Les commentaires citent le motif pour expliquer pourquoi il est proscrit : ce n'est pas du code.
  .filter((l) => /toISOString\(\)\.slice\(0,\s*10\)/.test(l.texte) && !/^\s*(\/\/|\*)/.test(l.texte))
  .map((l) => l.n);
// Seul usage legitime restant : l'expiration d'un devis, calculee a partir d'une chaine deja
// interpretee en UTC (new Date("YYYY-MM-DD")) — entree et sortie dans le meme repere, pas de
// decalage possible. Identifie par son contenu et non par son numero de ligne, pour que le test
// ne se mette pas a echouer au premier ajout ailleurs dans le fichier.
const AUTORISE = /const expiration=envoi\?new Date\(new Date\(envoi\)/;
const suspects = restants.filter((n) => !AUTORISE.test(lignes[n - 1]));
t(
  `un seul usage restant, sur l'expiration des devis (${restants.length} trouve(s))`,
  restants.length === 1 && suspects.length === 0,
  suspects.length ? `a corriger : lignes ${suspects.join(", ")}` : `${restants.length} usages`,
);

// ── 6. Import CSV bancaire : la date venue du fichier est validee ────────────
console.log("\n6. Import CSV bancaire — date non validee = HTML injecte dans l'apercu");
t(
  "la ligne est rejetee si la date n'a pas la forme YYYY-MM-DD",
  /if\(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(d\)\|\|isNaN\(amount\)\)continue;/.test(html),
);
t("l'apercu affiche la date en francais, pas l'ISO brut", html.includes("<td>${dateFr(r.booking_date)}</td>"));
t("plus aucune interpolation brute de booking_date", !html.includes("${r.booking_date}"));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
