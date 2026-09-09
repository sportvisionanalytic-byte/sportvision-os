// Extraction des evenements d'une ou plusieurs feuilles d'un planning .xlsx, avec le moteur de
// l'application, vers un JSON relu avant toute ecriture en base.
//
// Lancement :
//   node scripts/extraire-planning-matchs.ts <xlsx> <equipes.json> <sortie.json> <feuille…>
//
// ── Pourquoi le mapping est FORCE et non detecte ──
// Sur le planning reel de Villemomble (09/09/2026), la detection automatique prenait la colonne
// COMPETITION pour l'equipe du club : 27 matchs se retrouvaient attribues a une equipe nommee
// « Amical ». Le fichier a pourtant une structure stable et explicite, la meme sur chaque onglet :
//
//   0 CATEGORIES VSF · 1 ADVERSAIRES · 2 RDV · 3 EDUCATEURS · 4 COMPETITION
//   5 HORAIRES COUP D'ENVOI · 6 LIEU · 7 Couleurs · 8 MINIBUS
//
// et enrichirDepuisSections ajoute la date en DERNIERE colonne. Designer ces colonnes vaut mieux
// que laisser deviner : c'est exactement ce que l'ecran d'import permet de faire a la main.
// L'index de la colonne date est calcule par feuille, la largeur variant d'un onglet a l'autre.
//
// N'ecrit qu'un fichier JSON local. Aucun acces a la base.

import { readFile, writeFile } from "node:fs/promises";
import { readXlsx } from "../src/lib/calendar/xlsx.ts";
import { rowsToSourceEvents } from "../src/lib/calendar/tabular.ts";
import { enrichirDepuisSections } from "../src/lib/calendar/tabular-sections.ts";

const [chemin, cheminEquipes, sortie, ...feuillesArg] = process.argv.slice(2);
if (!chemin || !cheminEquipes || !sortie || feuillesArg.length === 0) {
  console.error("Usage : node scripts/extraire-planning-matchs.ts <xlsx> <equipes.json> <sortie.json> <index feuille…>");
  process.exit(1);
}

const buffer = await readFile(chemin);
const octets = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
const classeur = await readXlsx(octets);

const voulues = new Set(feuillesArg.map(Number));
const tout: unknown[] = [];
const rejets: unknown[] = [];

classeur.sheets.forEach((feuille, index) => {
  if (!voulues.has(index)) return;
  const lignes = enrichirDepuisSections(feuille.rows);
  if (!lignes) {
    console.error(`${feuille.name.trim()} : pas un planning par blocs, ignoree.`);
    return;
  }
  const colonneDate = (lignes[0]?.length ?? 1) - 1;
  const { events, issues } = rowsToSourceEvents(lignes, {
    mapping: {
      sheetIndex: index,
      headerRow: 0,
      columns: { team: 0, opponent: 1, competition: 4, time: 5, location: 6, date: colonneDate },
    },
  });
  console.error(`${feuille.name.trim()} : ${events.length} evenements, ${issues.length} rejets (date en colonne ${colonneDate})`);
  for (const e of events) tout.push({ ...e, feuille: feuille.name.trim() });
  for (const i of issues) rejets.push({ ...i, feuille: feuille.name.trim() });
});

await writeFile(sortie, JSON.stringify({ evenements: tout, rejets }, null, 1), "utf8");
console.error(`\n${tout.length} evenements et ${rejets.length} rejets ecrits dans ${sortie}`);
