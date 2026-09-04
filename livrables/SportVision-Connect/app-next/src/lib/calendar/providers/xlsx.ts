// Provider FOOTCLUBS_XLSX — lecture technique prête, mapping métier volontairement VIDE.
//
// ── Ce qui est fait ici ──
// Lire un .xlsx déposé par un club : ouvrir l'archive, lister ses feuilles, afficher les
// en-têtes et les premières lignes telles quelles, puis produire des matchs à partir d'un mapping
// de colonnes que l'HUMAIN a désigné à l'écran.
//
// ── Ce qui n'est pas fait, et pourquoi ──
// Aucun nom de colonne Footclubs n'est écrit en dur. Ni "Equipe", ni "Adversaire", ni "Date", ni
// "Heure", ni "Compétition" : le format réel de l'export Footclubs n'a jamais été vu (Footclubs
// est derrière l'authentification du club, aucun export réel n'a encore été fourni). Deviner ces
// libellés produirait un mapping faux qui marche sur un fichier et casse sur le suivant, et
// surtout un import silencieusement décalé d'une colonne — le pire cas possible pour un club qui
// ferait confiance au résultat.
//
// Ce provider n'hérite donc PAS des listes d'en-têtes de providers/csv.ts, alors qu'elles
// existent : elles ont été écrites pour du CSV générique, pas pour Footclubs. Les réutiliser ici
// reviendrait à prétendre connaître le format.
//
// Quand un vrai export Footclubs sera fourni : lire ses colonnes réelles, poser le mapping par
// défaut dans DEFAULT_MAPPING_BY_SIGNATURE ci-dessous, tester sur plusieurs compétitions, et
// passer `isReady` à true. Rien d'autre à changer — le moteur, la preview, le diff et la sync
// sont déjà communs à tous les providers.

import {
  coerceSportStatus,
  normalizeOpponentValue,
  normalizeScore,
  parseFlexibleDate,
  parseFlexibleTime,
  teamMatchKey,
} from "../normalize.ts";
import { readXlsx } from "../xlsx.ts";
import type { CalendarProvider, ParseResult, ProviderInput, SourceEvent, SourceIssue, SourceInspection } from "../types.ts";

/** Champs qu'une colonne du tableur peut alimenter. `opponent` et `date` sont les seuls
 * obligatoires — ce sont aussi les seuls sans lesquels un match n'existe pas. */
export const XLSX_FIELDS = [
  "opponent",
  "date",
  "time",
  "team",
  "competition",
  "status",
  "location",
  "score",
  "home",
  "externalEventId",
  "externalTeamId",
  "externalCompetitionId",
] as const;

export type XlsxField = (typeof XLSX_FIELDS)[number];

export const XLSX_FIELD_LABELS: Record<XlsxField, string> = {
  opponent: "Adversaire (obligatoire)",
  date: "Date (obligatoire)",
  time: "Heure",
  team: "Équipe du club",
  competition: "Compétition",
  status: "Statut du match",
  location: "Lieu",
  score: "Score",
  home: "Domicile / extérieur",
  externalEventId: "Identifiant du match chez la source",
  externalTeamId: "Identifiant de l'équipe chez la source",
  externalCompetitionId: "Identifiant de la compétition chez la source",
};

export const XLSX_REQUIRED_FIELDS: XlsxField[] = ["opponent", "date"];

export interface XlsxColumnMapping {
  sheetIndex: number;
  /** Index 0-based de la ligne d'en-tête dans la feuille. */
  headerRow: number;
  /** Index 0-based de la première ligne de données (par défaut headerRow + 1). */
  firstDataRow?: number;
  /** Champ → index de colonne, tel que désigné par l'utilisateur. */
  columns: Partial<Record<XlsxField, number>>;
}

/**
 * Emplacement prévu pour les mappings connus, indexés par signature de fichier (la liste de ses
 * en-têtes). VIDE À DESSEIN tant qu'aucun export Footclubs réel n'a été fourni. Le jour où c'est
 * le cas, une entrée ici suffit à pré-remplir l'écran de mapping, sans toucher au reste.
 */
export const DEFAULT_MAPPING_BY_SIGNATURE: Record<string, XlsxColumnMapping> = {};

/** Signature d'une feuille = ses en-têtes normalisés, dans l'ordre. Sert à reconnaître un format
 * déjà mappé une fois — sans jamais deviner un format inconnu. */
export function sheetSignature(headerRow: string[]): string {
  return headerRow.map((h) => teamMatchKey(h)).join("|");
}

async function toWorkbook(input: ProviderInput) {
  if (!input.bytes) throw new Error("Fichier .xlsx vide ou illisible.");
  return readXlsx(input.bytes);
}

/** Nombre de lignes montrées dans l'écran de mapping. Assez pour reconnaître la structure d'un
 * export (parfois précédé de 2-3 lignes de titre), pas assez pour noyer l'écran. */
const PREVIEW_ROWS = 12;

export const xlsxProvider: CalendarProvider = {
  id: "FOOTCLUBS_XLSX",
  label: "Fichier Excel .xlsx (export Footclubs ou autre tableur)",
  accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  needsColumnMapping: true,
  reads: "binary",
  // false : la lecture marche, mais aucun mapping Footclubs réel n'est connu. L'UI le dit
  // explicitement à l'utilisateur plutôt que de laisser croire à un import automatique.
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
        rows: sheet.rows.slice(0, PREVIEW_ROWS).map((row) => row.map((cell) => cell ?? "")),
        rowCount: sheet.rows.length,
      })),
    };
  },

  async parse(input: ProviderInput): Promise<ParseResult> {
    const mapping = input.options as XlsxColumnMapping | undefined;
    if (!mapping) {
      return {
        events: [],
        issues: [{ line: 0, raw: input.fileName, reason: "Aucun mapping de colonnes : désignez au minimum l'adversaire et la date." }],
      };
    }

    const missing = XLSX_REQUIRED_FIELDS.filter((field) => mapping.columns[field] === undefined);
    if (missing.length > 0) {
      return {
        events: [],
        issues: [
          {
            line: 0,
            raw: input.fileName,
            reason: `Colonne(s) obligatoire(s) non désignée(s) : ${missing.map((f) => XLSX_FIELD_LABELS[f]).join(", ")}.`,
          },
        ],
      };
    }

    const workbook = await toWorkbook(input);
    const sheet = workbook.sheets[mapping.sheetIndex];
    if (!sheet) {
      return { events: [], issues: [{ line: 0, raw: input.fileName, reason: "Feuille de calcul introuvable." }] };
    }

    const firstDataRow = mapping.firstDataRow ?? mapping.headerRow + 1;
    const events: SourceEvent[] = [];
    const issues: SourceIssue[] = [];

    const at = (row: string[], field: XlsxField): string | undefined => {
      const index = mapping.columns[field];
      return index === undefined ? undefined : row[index];
    };

    for (let i = firstDataRow; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      const humanLine = i + 1; // numéro de ligne tel qu'affiché par Excel
      const opponentRaw = at(row, "opponent")?.trim() ?? "";
      const dateRaw = at(row, "date")?.trim() ?? "";

      if (!opponentRaw && !dateRaw) continue;
      if (!opponentRaw) {
        issues.push({ line: humanLine, raw: row.join(" | "), reason: "Adversaire manquant." });
        continue;
      }
      const matchDate = parseFlexibleDate(dateRaw);
      if (!matchDate) {
        issues.push({
          line: humanLine,
          raw: row.join(" | "),
          reason: dateRaw ? `Date illisible ("${dateRaw}").` : "Date manquante.",
        });
        continue;
      }

      const timeRaw = at(row, "time")?.trim();
      const kickoffTime = timeRaw ? parseFlexibleTime(timeRaw) : null;
      if (timeRaw && !kickoffTime) {
        issues.push({ line: humanLine, raw: row.join(" | "), reason: `Heure illisible ("${timeRaw}") — match importé sans heure.` });
      }

      const homeRaw = at(row, "home")?.trim();
      const homeKey = homeRaw ? teamMatchKey(homeRaw) : "";

      events.push({
        sourceLine: humanLine,
        rawLabel: opponentRaw,
        externalEventId: at(row, "externalEventId")?.trim() || null,
        externalCompetitionId: at(row, "externalCompetitionId")?.trim() || null,
        competitionName: at(row, "competition")?.trim() || null,
        externalTeamId: at(row, "externalTeamId")?.trim() || null,
        sourceTeamName: at(row, "team")?.trim() || null,
        opponent: normalizeOpponentValue(opponentRaw),
        matchDate,
        kickoffTime,
        location: at(row, "location")?.trim() || null,
        isHome: homeKey ? ["dom", "domicile", "d", "home", "h", "oui", "o"].includes(homeKey) : null,
        sportStatus: at(row, "status")?.trim() ? coerceSportStatus(at(row, "status")) : null,
        score: normalizeScore(at(row, "score")),
        sourceUpdatedAt: null,
      });
    }

    return { events, issues };
  },
};
