// Import calendrier (FFF/ICS/CSV) — parsers purs, aucune dépendance Supabase. Prompt #6 du
// backlog Club+ V2 (Calendrier central) : un club exporte son calendrier depuis le site de sa
// fédération (format .ics standard) ou dépose un tableur (.csv) et le retrouve directement dans
// club_matches (cma_member_insert, RLS déjà permissive à tout membre du club — jamais construit
// jusqu'ici faute d'UI, voir migration-clubplus-v37.sql). Aucun format FFF officiel documenté
// disponible : le parseur ICS suit RFC 5545 (SUMMARY/DTSTART/LOCATION), assez générique pour
// couvrir un export FFF réel sans supposer une structure propriétaire non vérifiable.
//
// Volontairement PAS d'auto-détection silencieuse de l'adversaire : le SUMMARY d'un événement ICS
// n'a pas de format garanti (une fédération peut écrire "Club A - Club B", "Club A vs Club B", ou
// juste le nom de l'équipe adverse). On propose une valeur pré-remplie mais l'admin revoit et
// corrige chaque ligne avant import, même discipline que l'anti-doublon effectif (preview avant
// confirmation).

export interface ImportedMatchRow {
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM, purement indicatif — club_matches n'a pas de colonne heure
  location: string | null;
  suggestedOpponent: string;
}

function unfoldIcsLines(raw: string): string[] {
  const rawLines = raw.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsDate(value: string): { date: string; time: string | null } | null {
  // Formes gérées : YYYYMMDD (journée entière) et YYYYMMDDTHHMMSS[Z] (avec heure, fuseau ignoré —
  // les clubs amateurs sont mono-fuseau France, cohérent avec le reste de l'app).
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const date = `${y}-${m}-${d}`;
  const time = hh && mm ? `${hh}:${mm}` : null;
  return { date, time };
}

/** Coupe sur les séparateurs les plus courants d'un titre d'export fédéral ("Club A - Club B",
 * "Club A vs Club B") ; sans séparateur reconnu, renvoie le titre entier tel quel — jamais un
 * nom d'adversaire deviné à l'aveugle. */
function suggestOpponentFromTitle(title: string): string {
  const separators = [" vs ", " VS ", " - ", " – "];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep).map((p) => p.trim());
      if (parts.length === 2 && parts[1]) return parts[1];
    }
  }
  return title;
}

export function parseIcsEvents(icsText: string): ImportedMatchRow[] {
  const lines = unfoldIcsLines(icsText);
  const events: ImportedMatchRow[] = [];
  let inEvent = false;
  let summary = "";
  let dtstart = "";
  let location = "";

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      summary = "";
      dtstart = "";
      location = "";
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (inEvent && dtstart) {
        const parsed = parseIcsDate(dtstart);
        if (parsed) {
          const title = summary || "Événement importé";
          events.push({
            title,
            date: parsed.date,
            time: parsed.time,
            location: location || null,
            suggestedOpponent: suggestOpponentFromTitle(title),
          });
        }
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    if (line.startsWith("SUMMARY")) {
      summary = line.slice(line.indexOf(":") + 1).trim();
    } else if (line.startsWith("DTSTART")) {
      dtstart = line.slice(line.indexOf(":") + 1).trim();
    } else if (line.startsWith("LOCATION")) {
      location = line.slice(line.indexOf(":") + 1).trim().replace(/\\,/g, ",");
    }
  }

  return events;
}

/** CSV souple, même patron dépendance-libre que roster-import.ts (parseRosterCsv) : détection
 * `;`/`,`, en-têtes reconnus en français avec variantes courantes. Colonnes attendues : adversaire
 * (obligatoire), date (obligatoire, JJ/MM/AAAA ou AAAA-MM-JJ), heure/lieu (optionnels). */
export function parseMatchesCsv(csvText: string): ImportedMatchRow[] {
  const lines = csvText.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseRow(lines[0]!).map((h) => h.toLowerCase());
  const findCol = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const iOpponent = findCol("adversaire", "opponent", "equipe adverse");
  const iDate = findCol("date");
  const iTime = findCol("heure", "time");
  const iLocation = findCol("lieu", "location", "adresse");

  if (iOpponent === -1 || iDate === -1) return [];

  const normalizeDate = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
    return null;
  };

  const rows: ImportedMatchRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseRow(line);
    const opponent = cells[iOpponent]?.trim();
    const dateRaw = cells[iDate]?.trim();
    if (!opponent || !dateRaw) continue;
    const date = normalizeDate(dateRaw);
    if (!date) continue;
    rows.push({
      title: opponent,
      date,
      time: iTime !== -1 ? (cells[iTime]?.trim() || null) : null,
      location: iLocation !== -1 ? (cells[iLocation]?.trim() || null) : null,
      suggestedOpponent: opponent,
    });
  }
  return rows;
}
