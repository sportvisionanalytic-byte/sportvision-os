// Conversion « tableau de cellules + mapping » → événements normalisés.
//
// CSV et XLSX ne diffèrent que par la façon d'obtenir les cellules : découper des lignes de texte
// d'un côté, ouvrir une archive de l'autre. Une fois qu'on a `string[][]`, le reste est identique.
// Ce fichier porte donc cette partie une seule fois : c'est ce qui garantit qu'un .xlsx et un .csv
// contenant la même chose produisent exactement le même résultat, y compris sur les cas pénibles
// (heure illisible, ligne vide, date au format inattendu).

import {
  coerceSportStatus,
  normalizeOpponentValue,
  normalizeScore,
  parseFlexibleDate,
  parseFlexibleTime,
  teamMatchKey,
} from "./normalize.ts";
import type { ParseResult, SourceEvent, SourceIssue, TabularField, TabularMapping } from "./types.ts";

const HOME_WORDS = ["dom", "domicile", "d", "home", "h", "recevant", "oui", "o", "true", "1", "x"];
const AWAY_WORDS = ["ext", "exterieur", "e", "away", "a", "visiteur", "non", "n", "false", "0"];

/** true = domicile, false = extérieur, null = la cellule ne dit ni l'un ni l'autre. Jamais un
 * défaut inventé : `club_matches.is_home` a déjà le sien. */
function parseHome(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const value = teamMatchKey(raw);
  if (!value) return null;
  if (HOME_WORDS.includes(value)) return true;
  if (AWAY_WORDS.includes(value)) return false;
  return null;
}

export interface TabularParseOptions {
  mapping: TabularMapping;
  /** Colonne "date de modification" (fraîcheur de la source, pas un champ du match). */
  updatedAtColumn?: number | null;
}

export function rowsToSourceEvents(rows: string[][], options: TabularParseOptions): ParseResult {
  const { mapping } = options;
  const firstDataRow = mapping.firstDataRow ?? mapping.headerRow + 1;
  const events: SourceEvent[] = [];
  const issues: SourceIssue[] = [];

  const at = (row: string[], field: TabularField): string | undefined => {
    const index = mapping.columns[field];
    return index === undefined ? undefined : row[index];
  };

  for (let i = Math.max(0, firstDataRow); i < rows.length; i++) {
    const row = rows[i] ?? [];
    // Numéro tel que l'utilisateur le voit dans son tableur ou son éditeur de texte : c'est celui
    // qu'il faut lui donner pour qu'il retrouve sa ligne fautive sans compter.
    const humanLine = i + 1;
    const rawLine = row.join(" | ");

    const opponentRaw = at(row, "opponent")?.trim() ?? "";
    const dateRaw = at(row, "date")?.trim() ?? "";

    if (!opponentRaw && !dateRaw) continue; // ligne totalement vide : pas une erreur
    if (!opponentRaw) {
      issues.push({ line: humanLine, raw: rawLine, reason: "Adversaire manquant." });
      continue;
    }

    const matchDate = parseFlexibleDate(dateRaw);
    if (!matchDate) {
      issues.push({
        line: humanLine,
        raw: rawLine,
        reason: dateRaw
          ? `Date illisible ("${dateRaw}"). Formats acceptés : JJ/MM/AAAA ou AAAA-MM-JJ.`
          : "Date manquante.",
      });
      continue;
    }

    const timeRaw = at(row, "time")?.trim();
    const kickoffTime = timeRaw ? parseFlexibleTime(timeRaw) : null;
    if (timeRaw && !kickoffTime) {
      // L'heure est optionnelle : une cellule d'horaire mal remplie ne fait pas perdre le match.
      // Elle est signalée, et la ligne est importée sans heure.
      issues.push({ line: humanLine, raw: rawLine, reason: `Heure illisible ("${timeRaw}") — match importé sans heure.` });
    }

    const statusRaw = at(row, "status")?.trim();
    const updatedRaw = options.updatedAtColumn != null ? row[options.updatedAtColumn]?.trim() : undefined;
    const updatedDate = updatedRaw ? parseFlexibleDate(updatedRaw) : null;

    events.push({
      sourceLine: humanLine,
      rawLabel: opponentRaw,
      externalEventId: at(row, "externalEventId")?.trim() || null,
      externalCompetitionId: at(row, "externalCompetitionId")?.trim() || null,
      competitionName: at(row, "competition")?.trim() || null,
      externalTeamId: at(row, "externalTeamId")?.trim() || null,
      // À défaut de colonne « équipe », la compétition sert d'identité d'équipe côté source.
      //
      // C'est le cas des exports de district (constaté le 09/09/2026 sur un vrai planning) : la
      // colonne équipe y porte le nom FÉDÉRAL du club — « AS VLG 21 » — identique pour toutes les
      // catégories, donc inutilisable pour répartir. C'est la compétition qui distingue :
      // « U18 Departemental 2 », « U15 Access D2 »…
      //
      // Le rapprochement reste ensuite le même : l'humain associe une fois « U18 Departemental 2 »
      // à son équipe U18, et club_team_source_mappings s'en souvient.
      sourceTeamName: at(row, "team")?.trim() || at(row, "competition")?.trim() || null,
      opponent: normalizeOpponentValue(opponentRaw),
      matchDate,
      kickoffTime,
      location: at(row, "location")?.trim() || null,
      isHome: parseHome(at(row, "home")),
      // `null` (et non "scheduled") quand la source n'a pas de colonne statut ou que la cellule est
      // vide : elle est muette, elle n'affirme rien. Voir SourceEvent.sportStatus.
      sportStatus: statusRaw ? coerceSportStatus(statusRaw) : null,
      score: normalizeScore(at(row, "score")),
      sourceUpdatedAt: updatedDate ? new Date(`${updatedDate}T00:00:00Z`).toISOString() : null,
    });
  }

  return { events, issues };
}
