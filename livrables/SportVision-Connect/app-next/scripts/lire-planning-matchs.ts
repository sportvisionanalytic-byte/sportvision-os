// Lecture d'un planning de matchs .xlsx AVEC LE MOTEUR DE L'APPLICATION, pas une relecture
// parallele. Sert a preparer un import en verifiant, hors interface, ce que le moteur comprend
// reellement du fichier : feuille par feuille, combien de lignes il reconnait et ce qu'il en tire.
//
// Lancement :  node scripts/lire-planning-matchs.ts <chemin.xlsx> [equipes.json]
// `equipes.json` est un tableau [{"name": "..."}] : quand il est fourni, la detection sait
// laquelle des deux colonnes texte porte les equipes du club, et laquelle porte l'adversaire.
//
// Le script n'ecrit RIEN, ni en base ni sur disque. Il n'existe que pour regarder avant d'agir.

import { readFile } from "node:fs/promises";
import { readXlsx } from "../src/lib/calendar/xlsx.ts";
import { rowsToSourceEvents } from "../src/lib/calendar/tabular.ts";
import { enrichirDepuisSections } from "../src/lib/calendar/tabular-sections.ts";
import { detectTabularLayout, layoutToMapping } from "../src/lib/calendar/autodetect.ts";

const chemin = process.argv[2];
const cheminEquipes = process.argv[3];
if (!chemin) {
  console.error("Usage : node scripts/lire-planning-matchs.ts <chemin.xlsx> [equipes.json]");
  process.exit(1);
}

const teams = cheminEquipes
  ? (JSON.parse(await readFile(cheminEquipes, "utf8")) as { name: string }[])
  : undefined;

const buffer = await readFile(chemin);
const octets = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
const classeur = await readXlsx(octets);

console.log(`Feuilles : ${classeur.sheets.length}${teams ? ` · ${teams.length} equipes du club fournies` : ""}\n`);
console.log("feuille              lignes  lus  rejets  periode couverte        adversaires numeriques");
console.log("─".repeat(100));

let total = 0;
let numeriquesTotal = 0;

classeur.sheets.forEach((feuille, index) => {
  const brut = feuille.rows;
  // Les plannings « par blocs » (une date en titre de section) passent d'abord par la remise a
  // plat, exactement comme dans l'ecran d'import.
  const lignes = enrichirDepuisSections(brut) ?? brut;
  const layout = detectTabularLayout(lignes, { teams, sheetIndex: index });
  const { events, issues } = rowsToSourceEvents(lignes, { mapping: layoutToMapping(layout, index) });
  total += events.length;

  const dates = events.map((e) => e.matchDate).filter(Boolean).sort();
  // Un adversaire entierement numerique trahit une colonne mal choisie : aucun club ne s'appelle
  // « 873 ». C'est le signal le plus sur que la detection s'est trompee sur cette feuille.
  const numeriques = events.filter((e) => /^\d+$/.test((e.opponent ?? "").trim())).length;
  numeriquesTotal += numeriques;

  const periode = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "—";
  console.log(
    `${feuille.name.trim().padEnd(20)} ${String(brut.length).padStart(6)} ${String(events.length).padStart(4)} ` +
    `${String(issues.length).padStart(7)}  ${periode.padEnd(24)} ${numeriques ? `${numeriques}/${events.length}` : "-"}`,
  );
});

console.log("─".repeat(100));
console.log(`${total} evenements lus, dont ${numeriquesTotal} avec un adversaire purement numerique.`);
