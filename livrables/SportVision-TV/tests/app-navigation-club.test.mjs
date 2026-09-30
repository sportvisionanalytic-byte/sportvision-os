// LA NAVIGATION DE L'APPLICATION EST-ELLE TOUJOURS CELLE DE CLUB+ ? (30/09/2026)
//
// POURQUOI CE TEST EXISTE. L'application mobile ne peut pas importer le code du site : ce sont deux
// projets, l'un en React Native, l'autre en Next.js. `src/lib/navigation-club.ts` est donc une COPIE
// des tables de `app-next/src/lib/navigation.ts`, et une copie dérive. Le jour où quelqu'un ajoute
// une entrée au menu du coach côté site, le téléphone garde l'ancien menu sans que rien ne le dise.
//
// C'est exactement le défaut qu'on vient de corriger, en plus discret : jusqu'au 30/09, le
// téléphone servait à TOUT LE MONDE le menu de l'administrateur, parce que sa copie datait d'avant
// les navigations par rôle du 10/09.
//
// CE QU'IL COMPARE : pour chaque rôle, la SUITE ORDONNÉE des titres de section et des entrées
// (libellé + chemin). Ni les icônes — le site n'en a pas dans cette table — ni les clés de module,
// qui ne servent qu'au site.
//
// CE QU'IL NE COMPARE PAS, et c'est volontaire : les navigations des autres types d'organisation
// (académie, tournoi, agence CM, joueur, parent). L'espace club du téléphone ne les sert jamais :
// `lireMesClubs` lit `club_members` joint à `clubs`, donc uniquement de vrais clubs, et tout le
// reste retombe sur la vue web de Club+.
import { readFileSync } from "node:fs";

const RACINE = new URL("../../../", import.meta.url).pathname;
const SITE = readFileSync(`${RACINE}livrables/SportVision-Connect/app-next/src/lib/navigation.ts`, "utf8");
const APP = readFileSync(`${RACINE}livrables/SportVision-App/src/lib/navigation-club.ts`, "utf8");

/** Les tables à comparer : nom côté site, nom côté application. */
const TABLES = [
  ["NAV_CLUB_FULLCOM", "CLUB"],
  ["NAV_CLUB_COACH", "COACH"],
  ["NAV_CLUB_COMMUNICATION", "COMMUNICATION"],
  ["NAV_CLUB_CM_SPORTVISION", "CM_SPORTVISION"],
  ["NAV_CLUB_TRESORIER", "TRESORIER"],
  ["NAV_CLUB_ADMINISTRATIF", "ADMINISTRATIF"],
  ["NAV_CLUB_RESPONSABLE_SPONSORS", "SPONSORS"],
  ["NAV_CLUB_LECTURE_SEULE", "LECTURE_SEULE"],
];

/** Le corps d'un `const NOM: ... = [ ... ];`, commentaires retirés. */
function corps(source, nom) {
  const debut = source.indexOf(`const ${nom}`);
  if (debut < 0) throw new Error(`table introuvable : ${nom}`);
  const ouvre = source.indexOf("[", debut);
  const ferme = source.indexOf("\n];", ouvre);
  if (ouvre < 0 || ferme < 0) throw new Error(`table illisible : ${nom}`);
  return source.slice(ouvre, ferme).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** La suite ordonnée des lignes : ["section", titre] ou ["item", libellé, chemin]. */
function lignes(texte, { section, item, cheminAbsolu }) {
  const sortie = [];
  const motif = new RegExp(
    `\\b(${section}|${item})\\s*\\(\\s*("(?:[^"\\\\]|\\\\.)*")` +
    `(?:\\s*(?:as ModuleKey)?\\s*,\\s*("(?:[^"\\\\]|\\\\.)*")\\s*,\\s*("(?:[^"\\\\]|\\\\.)*"))?`,
    "g",
  );
  let m;
  while ((m = motif.exec(texte)) !== null) {
    if (m[1] === section) { sortie.push(["section", JSON.parse(m[2])]); continue; }
    if (!m[3] || !m[4]) throw new Error(`entrée illisible : ${m[0]}`);
    const chemin = JSON.parse(m[4]);
    sortie.push(["item", JSON.parse(m[3]), cheminAbsolu ? chemin : `/${chemin}`]);
  }
  return sortie;
}

let rouges = 0;
for (const [nomSite, nomApp] of TABLES) {
  const attendu = lignes(corps(SITE, nomSite), { section: "section", item: "item", cheminAbsolu: false });
  const obtenu = lignes(corps(APP, nomApp), { section: "t", item: "i", cheminAbsolu: true });

  if (!attendu.length) { console.log(`ROUGE ${nomSite} : aucune ligne lue côté site`); rouges++; continue; }

  const a = JSON.stringify(attendu, null, 1);
  const b = JSON.stringify(obtenu, null, 1);
  if (a === b) { console.log(`vert  ${nomApp} (${attendu.length} lignes)`); continue; }

  rouges++;
  console.log(`ROUGE ${nomApp} : l'application ne suit plus ${nomSite}`);
  const max = Math.max(attendu.length, obtenu.length);
  for (let k = 0; k < max; k++) {
    const x = JSON.stringify(attendu[k] ?? null);
    const y = JSON.stringify(obtenu[k] ?? null);
    if (x !== y) console.log(`        ligne ${k + 1}\n          site : ${x}\n          app  : ${y}`);
  }
}

// LES ONGLETS DOIVENT EXISTER DANS LE MENU DU RÔLE. Un onglet vers une entrée que le rôle n'a pas
// serait exactement le défaut qu'on corrige : une destination proposée à quelqu'un qui n'y a rien
// à faire. On relit la table de l'application et on vérifie chaque chemin.
const onglets = APP.slice(APP.indexOf("const ONGLETS_PAR_ROLE"), APP.indexOf("const ONGLETS_PAR_DEFAUT"));
const TABLE_DU_ROLE = { coach: "COACH", resp_equipe: "COACH", comm: "COMMUNICATION",
  cm_externe: "CM_SPORTVISION", tresorier: "TRESORIER", administratif: "ADMINISTRATIF",
  sponsor_mgr: "SPONSORS", lecture_seule: "LECTURE_SEULE" };
for (const [role, table] of Object.entries(TABLE_DU_ROLE)) {
  const ligne = onglets.match(new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`));
  if (!ligne) { console.log(`ROUGE onglets : aucun onglet défini pour ${role}`); rouges++; continue; }
  const chemins = [...ligne[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const dansLeMenu = new Set(
    lignes(corps(APP, table), { section: "t", item: "i", cheminAbsolu: true })
      .filter((l) => l[0] === "item").map((l) => l[2]),
  );
  const orphelins = chemins.filter((c) => !dansLeMenu.has(c));
  if (orphelins.length) {
    rouges++;
    console.log(`ROUGE onglets ${role} : ${orphelins.join(", ")} n'est pas dans son menu`);
  } else {
    console.log(`vert  onglets ${role} (${chemins.length})`);
  }
}

console.log(rouges ? `\n${rouges} écart(s)` : "\nLa navigation de l'application suit Club+");
process.exit(rouges ? 1 : 0);
