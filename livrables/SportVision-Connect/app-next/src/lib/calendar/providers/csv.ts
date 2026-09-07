// Provider CSV — un tableur exporté par le club, ou un fichier bricolé à la main.
//
// Deux niveaux de reconnaissance, dans cet ordre :
//   1. le NOM des colonnes, en vocabulaire générique français/anglais (header-hints.ts), comme
//      roster-import.ts le fait déjà pour les effectifs ;
//   2. si ça ne suffit pas pour les deux colonnes obligatoires, le CONTENU des cellules
//      (autodetect.ts) : une colonne de dates est la colonne date, quel que soit son intitulé.
//
// Le second niveau rend le CSV robuste à n'importe quel intitulé, y compris un fichier en anglais
// ou sans en-tête. Avant, un fichier dont les colonnes s'appelaient autrement renvoyait zéro
// ligne, sans autre recours qu'un message d'erreur.
//
// Aucun de ces libellés ne vient d'un export Footclubs, qui n'a jamais été vu : ce sont des mots
// français courants. Le provider FOOTCLUBS_XLSX, lui, ne s'appuie que sur le contenu.

import { detectTabularLayout } from "../autodetect.ts";
import { resolveByHeaderNames } from "../header-hints.ts";
import { rowsToSourceEvents } from "../tabular.ts";
import {
  TABULAR_REQUIRED_FIELDS,
  type CalendarProvider,
  type ParseResult,
  type ProviderInput,
  type TabularMapping,
} from "../types.ts";

/** Découpe une ligne CSV : guillemets, délimiteur échappé, `""` pour un guillemet littéral. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = {
    ";": (headerLine.match(/;/g) ?? []).length,
    ",": (headerLine.match(/,/g) ?? []).length,
    "\t": (headerLine.match(/\t/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ";";
}

export function csvToRows(csvText: string): string[][] {
  const lines = csvText.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delimiter = detectDelimiter(lines[0]!);
  return lines.map((line, index) => splitCsvLine(index === 0 ? line.replace(/^\uFEFF/, "") : line, delimiter));
}

export function parseCsvSource(csvText: string, teams?: { name: string }[]): ParseResult {
  const rows = csvToRows(csvText);
  if (rows.length < 2) {
    return {
      events: [],
      issues: [{ line: 0, raw: "", reason: "Fichier vide ou sans ligne de données sous l'en-tête." }],
    };
  }

  const headers = rows[0]!;
  const byName = resolveByHeaderNames(headers);
  let mapping: TabularMapping = { sheetIndex: 0, headerRow: 0, firstDataRow: 1, columns: byName.columns };
  let updatedAtColumn = byName.updatedAt;

  const missing = TABULAR_REQUIRED_FIELDS.filter((field) => mapping.columns[field] === undefined);
  if (missing.length > 0) {
    const layout = detectTabularLayout(rows, { teams });
    if (layout.missingRequired.length === 0) {
      mapping = {
        sheetIndex: 0,
        headerRow: layout.headerRow,
        firstDataRow: layout.firstDataRow,
        columns: layout.columns,
      };
      updatedAtColumn = layout.updatedAtColumn;
    } else {
      return {
        events: [],
        issues: [
          {
            line: 1,
            raw: headers.join(" | "),
            reason: `Colonne ${missing
              .map((f) => (f === "opponent" ? "adversaire" : "date"))
              .join(" et ")} introuvable, ni par son nom ni par son contenu. En-têtes lus : ${
              headers.join(", ") || "(aucun)"
            }.`,
          },
        ],
      };
    }
  }

  return rowsToSourceEvents(rows, { mapping, updatedAtColumn });
}

export const csvProvider: CalendarProvider = {
  id: "CSV",
  label: "Fichier .csv (tableur)",
  accept: ".csv,text/csv",
  needsColumnMapping: false,
  reads: "text",
  isReady: true,
  detect(fileName) {
    return fileName.toLowerCase().endsWith(".csv");
  },
  async parse(input: ProviderInput): Promise<ParseResult> {
    return parseCsvSource(input.text ?? "", input.teams);
  },
};
