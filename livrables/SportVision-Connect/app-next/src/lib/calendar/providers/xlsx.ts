// Provider FOOTCLUBS_XLSX — lecture d'un fichier Excel déposé par un club.
//
// ── Ce qui a changé (07/09/2026) ──
// La première version exigeait que l'utilisateur désigne douze colonnes à la main. C'était le mur
// de l'import. Le provider s'appuie maintenant sur la détection PAR CONTENU (autodetect.ts) :
// une colonne dont les cellules se lisent comme des dates est la colonne date, une colonne dont
// les valeurs sont les équipes du club est l'équipe, donc l'autre colonne texte est l'adversaire.
// Le mapping manuel reste disponible, mais seulement quand la détection échoue ou que
// l'utilisateur veut corriger — plus comme passage obligé.
//
// ── Ce qui n'a pas changé, et pourquoi ──
// Toujours AUCUN nom de colonne Footclubs en dur. Ni "Equipe", ni "Adversaire", ni "Date". Le
// format réel n'a jamais été vu (Footclubs est derrière l'authentification du club) et le deviner
// produirait un import silencieusement décalé d'une colonne, le pire cas possible pour un club qui
// ferait confiance au résultat.
//
// La détection par contenu n'est pas un contournement de cette règle, c'est l'inverse : elle ne
// suppose RIEN du format, elle lit les données. Et sa proposition est affichée à l'utilisateur
// avec le nom des colonnes reconnues, donc vérifiable d'un coup d'œil avant le moindre écrit.
//
// Ce provider n'utilise volontairement pas les listes d'intitulés de header-hints.ts comme signal
// principal : elles ont été écrites pour du CSV générique. Elles ne servent ici que d'arbitre,
// via autodetect, quand deux colonnes ont exactement le même profil.

import { detectTabularLayout, layoutToMapping, type DetectedLayout } from "../autodetect.ts";
import { rowsToSourceEvents } from "../tabular.ts";
import { readXlsx } from "../xlsx.ts";
import {
  TABULAR_FIELD_LABELS,
  TABULAR_REQUIRED_FIELDS,
  type CalendarProvider,
  type ParseResult,
  type ProviderInput,
  type SourceInspection,
  type TabularMapping,
} from "../types.ts";

async function toWorkbook(input: ProviderInput) {
  if (!input.bytes) throw new Error("Fichier .xlsx vide ou illisible.");
  return readXlsx(input.bytes);
}

/** Lignes remontées par `inspect()`. Assez pour que la détection ait de la matière et pour
 * reconnaître un export précédé de lignes de titre ; l'écran, lui, n'en affiche qu'une poignée. */
const INSPECT_ROWS = 40;

export const xlsxProvider: CalendarProvider = {
  id: "FOOTCLUBS_XLSX",
  label: "Fichier Excel .xlsx (export Footclubs ou autre tableur)",
  accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // false : la détection par contenu suffit dans le cas normal. Le mapping n'est demandé que
  // lorsqu'elle échoue, ce que l'appelant constate via `detectTabularLayout().missingRequired`.
  needsColumnMapping: false,
  reads: "binary",
  // Le format Footclubs reste inconnu : on ne promet pas un import Footclubs clé en main, on
  // promet de lire un tableur et de montrer ce qu'on a compris. L'UI le dit ainsi.
  isReady: false,

  detect(fileName) {
    return fileName.toLowerCase().endsWith(".xlsx");
  },

  async inspect(input: ProviderInput): Promise<SourceInspection> {
    const workbook = await toWorkbook(input);
    return {
      sheets: workbook.sheets.map((sheet, index) => ({
        index,
        name: sheet.name,
        rows: sheet.rows.slice(0, INSPECT_ROWS).map((row) => row.map((cell) => cell ?? "")),
        rowCount: sheet.rows.length,
      })),
    };
  },

  async parse(input: ProviderInput): Promise<ParseResult> {
    const workbook = await toWorkbook(input);
    const provided = input.options as TabularMapping | undefined;
    const sheetIndex = provided?.sheetIndex ?? pickBestSheet(workbook.sheets, input.teams);
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) {
      return { events: [], issues: [{ line: 0, raw: input.fileName, reason: "Feuille de calcul introuvable." }] };
    }

    // Mapping fourni (l'utilisateur a corrigé) : il fait foi. Sinon on détecte.
    let mapping = provided;
    let updatedAtColumn: number | null = null;
    if (!mapping || TABULAR_REQUIRED_FIELDS.some((f) => mapping!.columns[f] === undefined)) {
      const layout = detectTabularLayout(sheet.rows, { teams: input.teams });
      if (layout.missingRequired.length > 0) {
        return {
          events: [],
          issues: [
            {
              line: 0,
              raw: input.fileName,
              reason: `Impossible de reconnaître ${layout.missingRequired
                .map((f) => TABULAR_FIELD_LABELS[f].toLowerCase())
                .join(" et ")} dans « ${sheet.name} ». Désignez les colonnes vous-même.`,
            },
          ],
        };
      }
      mapping = layoutToMapping(layout, sheetIndex);
      updatedAtColumn = layout.updatedAtColumn;
    }

    return rowsToSourceEvents(sheet.rows, { mapping, updatedAtColumn });
  },
};

/** Ce que l'écran d'import a besoin de savoir pour AFFICHER ce qui a été compris : quelle feuille
 * a été retenue et quelles colonnes ont été reconnues. Sans ça, l'utilisateur devrait faire
 * confiance à une détection invisible. */
export function detectXlsxLayout(
  inspection: SourceInspection,
  teams?: { name: string }[],
): { sheetIndex: number; layout: DetectedLayout } {
  const sheets = inspection.sheets.map((s) => ({ name: s.name, rows: s.rows }));
  const sheetIndex = pickBestSheet(sheets, teams);
  return { sheetIndex, layout: detectTabularLayout(sheets[sheetIndex]?.rows ?? [], { teams }) };
}

/**
 * Un classeur Footclubs peut contenir plusieurs feuilles (une par équipe, ou des feuilles
 * annexes). On retient celle où la détection trouve le plus de champs, à égalité celle qui a le
 * plus de lignes. Bien meilleur défaut que « la première feuille », qui est souvent une page de
 * garde.
 */
function pickBestSheet(sheets: { name: string; rows: string[][] }[], teams?: { name: string }[]): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    const layout = detectTabularLayout(sheet.rows, { teams });
    const complete = layout.missingRequired.length === 0 ? 100 : 0;
    const score = complete + Object.keys(layout.columns).length * 5 + Math.min(sheet.rows.length, 50) / 50;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}
