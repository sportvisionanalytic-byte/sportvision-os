// Provider CSV — un tableur exporté par le club, ou un fichier bricolé à la main.
//
// Reconnaissance d'en-têtes en vocabulaire générique français/anglais (adversaire, date, heure,
// lieu…), exactement comme roster-import.ts le fait déjà pour les effectifs. Ce n'est PAS un
// mapping Footclubs : aucun de ces libellés ne vient d'un export Footclubs réel, et le provider
// FOOTCLUBS_XLSX ne réutilise volontairement aucune de ces listes (voir providers/xlsx.ts).
//
// Nouveau par rapport à la version d'origine : les colonnes optionnelles `id`, `compétition`,
// `statut`, `score`, `domicile` et `modifié le`. La colonne `id` est la plus importante : quand
// elle est présente, elle devient `external_event_id` et un changement de date/heure sur la même
// ligne devient une MISE À JOUR au lieu d'un doublon.

import {
  coerceSportStatus,
  normalizeOpponentValue,
  normalizeScore,
  parseFlexibleDate,
  parseFlexibleTime,
  teamMatchKey,
} from "../normalize.ts";
import type { CalendarProvider, ParseResult, ProviderInput, SourceEvent, SourceIssue } from "../types.ts";

const HEADERS = {
  externalEventId: ["id", "identifiant", "id match", "match id", "id rencontre", "numero", "no match", "n match"],
  externalCompetitionId: ["id competition", "code competition", "id championnat", "code epreuve"],
  sourceUpdatedAt: ["date de modification", "modifie le", "mise a jour", "maj", "last modified", "updated at"],
  opponent: ["adversaire", "opponent", "equipe adverse", "club adverse", "contre", "rencontre"],
  team: ["equipe", "mon equipe", "notre equipe", "team", "equipe locale", "categorie equipe"],
  competition: ["competition", "championnat", "epreuve", "poule", "coupe", "division"],
  status: ["statut", "status", "etat"],
  time: ["heure", "horaire", "time", "coup d envoi", "kickoff"],
  location: ["lieu", "location", "adresse", "terrain", "stade", "installation"],
  score: ["score", "resultat"],
  home: ["domicile", "dom ext", "domicile exterieur", "home"],
  date: ["date", "date du match", "date rencontre", "jour"],
} as const;

type FieldName = keyof typeof HEADERS;

// Ordre d'attribution volontairement du plus spécifique au plus générique. "date de modification"
// doit être capté par `sourceUpdatedAt` AVANT que `date` ne le réclame (il contient "date"), et
// "équipe adverse" par `opponent` avant que `team` ne le réclame (il contient "équipe"). Un ordre
// alphabétique ou déclaratif donnerait un mapping faux sur des fichiers parfaitement corrects.
const RESOLUTION_ORDER: FieldName[] = [
  "sourceUpdatedAt",
  "externalCompetitionId",
  "externalEventId",
  "opponent",
  "team",
  "competition",
  "status",
  "time",
  "location",
  "score",
  "home",
  "date",
];

/** Sélection d'une colonne en trois passes, de la plus stricte à la plus permissive — une
 * égalité exacte l'emporte toujours sur une correspondance partielle, quel que soit l'ordre des
 * colonnes dans le fichier. */
function pickColumn(normalizedHeaders: string[], candidates: readonly string[], taken: Set<number>): number | null {
  const free = normalizedHeaders.map((h, i) => ({ h, i })).filter(({ i }) => !taken.has(i));
  for (const candidate of candidates) {
    const exact = free.find(({ h }) => h === candidate);
    if (exact) return exact.i;
  }
  for (const candidate of candidates) {
    const prefix = free.find(({ h }) => h.startsWith(`${candidate} `) || h === candidate);
    if (prefix) return prefix.i;
  }
  for (const candidate of candidates) {
    // Passe permissive reservee aux libelles assez longs pour ne pas declencher de faux positif :
    // chercher "id" n'importe ou dans un en-tete accrocherait n'importe quelle colonne contenant
    // ces deux lettres, alors qu'une colonne d'identifiant s'appelle "id" tout court ou commence
    // par "id " - ces deux formes sont deja couvertes par les deux passes precedentes.
    if (candidate.length < 4) continue;
    const loose = free.find(({ h }) => h.includes(candidate));
    if (loose) return loose.i;
  }
  return null;
}

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

/** true si la cellule dit "domicile", false si elle dit "extérieur", null si elle ne dit ni l'un
 * ni l'autre — jamais un défaut inventé (`is_home` a déjà un défaut en base). */
function parseHome(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const value = teamMatchKey(raw);
  if (!value) return null;
  if (["dom", "domicile", "d", "home", "h", "oui", "o", "true", "1", "x"].includes(value)) return true;
  if (["ext", "exterieur", "e", "away", "a", "non", "n", "false", "0"].includes(value)) return false;
  return null;
}

export function parseCsvSource(csvText: string): ParseResult {
  const issues: SourceIssue[] = [];
  const lines = csvText.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      events: [],
      issues: [{ line: 0, raw: "", reason: "Fichier vide ou sans ligne de données sous l'en-tête." }],
    };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const rawHeaders = splitCsvLine(lines[0]!, delimiter).map((h) => h.replace(/^\uFEFF/, ""));
  const normalizedHeaders = rawHeaders.map((h) => teamMatchKey(h));

  const taken = new Set<number>();
  const cols = {} as Record<FieldName, number | null>;
  for (const field of RESOLUTION_ORDER) {
    const index = pickColumn(normalizedHeaders, HEADERS[field], taken);
    cols[field] = index;
    if (index !== null) taken.add(index);
  }

  if (cols.opponent === null || cols.date === null) {
    const missing = [cols.opponent === null ? "adversaire" : null, cols.date === null ? "date" : null]
      .filter(Boolean)
      .join(" et ");
    return {
      events: [],
      issues: [
        {
          line: 1,
          raw: rawHeaders.join(delimiter),
          reason: `Colonne ${missing} introuvable. En-têtes lus : ${rawHeaders.join(", ") || "(aucun)"}.`,
        },
      ],
    };
  }

  const cell = (cells: string[], index: number | null): string | undefined =>
    index === null ? undefined : cells[index];

  const events: SourceEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const humanLine = i + 1; // 1-based, en-tête comprise : le numéro que l'utilisateur voit dans son tableur
    const cells = splitCsvLine(lines[i]!, delimiter);
    const opponentRaw = cell(cells, cols.opponent)?.trim() ?? "";
    const dateRaw = cell(cells, cols.date)?.trim() ?? "";

    if (!opponentRaw && !dateRaw) continue; // ligne totalement vide, pas une erreur
    if (!opponentRaw) {
      issues.push({ line: humanLine, raw: lines[i]!, reason: "Adversaire manquant." });
      continue;
    }
    const matchDate = parseFlexibleDate(dateRaw);
    if (!matchDate) {
      issues.push({
        line: humanLine,
        raw: lines[i]!,
        reason: dateRaw ? `Date illisible ("${dateRaw}"). Formats acceptés : JJ/MM/AAAA ou AAAA-MM-JJ.` : "Date manquante.",
      });
      continue;
    }

    const timeRaw = cell(cells, cols.time)?.trim();
    const kickoffTime = timeRaw ? parseFlexibleTime(timeRaw) : null;
    if (timeRaw && !kickoffTime) {
      // L'heure est optionnelle : une heure illisible ne jette pas la ligne, elle est signalée et
      // la ligne est importée sans heure. Jeter le match entier pour une cellule d'horaire mal
      // remplie serait disproportionné (§"un import partiellement invalide ne doit pas rendre le
      // calendrier inutilisable").
      issues.push({ line: humanLine, raw: lines[i]!, reason: `Heure illisible ("${timeRaw}") — match importé sans heure.` });
    }

    const statusRaw = cell(cells, cols.status)?.trim();
    const updatedRaw = cell(cells, cols.sourceUpdatedAt)?.trim();
    const updatedDate = updatedRaw ? parseFlexibleDate(updatedRaw) : null;

    events.push({
      sourceLine: humanLine,
      rawLabel: opponentRaw,
      externalEventId: cell(cells, cols.externalEventId)?.trim() || null,
      externalCompetitionId: cell(cells, cols.externalCompetitionId)?.trim() || null,
      competitionName: cell(cells, cols.competition)?.trim() || null,
      externalTeamId: null,
      sourceTeamName: cell(cells, cols.team)?.trim() || null,
      opponent: normalizeOpponentValue(opponentRaw),
      matchDate,
      kickoffTime,
      location: cell(cells, cols.location)?.trim() || null,
      isHome: parseHome(cell(cells, cols.home)),
      // `null` (et non "scheduled") quand le fichier n'a pas de colonne statut ou que la cellule
      // est vide : la source est silencieuse, elle n'affirme rien. Voir SourceEvent.sportStatus.
      sportStatus: statusRaw ? coerceSportStatus(statusRaw) : null,
      score: normalizeScore(cell(cells, cols.score)),
      sourceUpdatedAt: updatedDate ? new Date(`${updatedDate}T00:00:00Z`).toISOString() : null,
    });
  }

  return { events, issues };
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
    return parseCsvSource(input.text ?? "");
  },
};
