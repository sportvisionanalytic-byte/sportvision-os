// Provider ICS (RFC 5545) — export standard d'un site fédéral, d'un Google Agenda ou d'un
// logiciel de club. Aucun format propriétaire supposé : uniquement des propriétés du standard
// (UID, DTSTART, SUMMARY, LOCATION, STATUS, LAST-MODIFIED, CATEGORIES).
//
// Ce que ce provider apporte par rapport à la version d'origine (lib/calendar-import.ts, avant ce
// chantier) : le **UID**. C'est lui qui devient `club_matches.external_event_id` et qui fait qu'un
// match dont la date ou l'heure change dans un ré-export est reconnu comme LE MÊME match et mis à
// jour, au lieu de créer un doublon. Sans UID, l'ICS retombait sur la clé de repli et tout
// changement d'horaire produisait une nouvelle ligne.

import { detectSportStatus, normalizeOpponentValue, splitTitleSides } from "../normalize.ts";
import type { CalendarProvider, ParseResult, ProviderInput, SourceEvent, SourceIssue, SportStatus } from "../types.ts";

/** Déplie les lignes repliées (RFC 5545 §3.1 : une continuation commence par un espace ou une
 * tabulation). Sans ça, un SUMMARY long est tronqué au milieu d'un mot. */
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

/** Sépare `NOM;PARAM=VALEUR:contenu`. Le premier ":" hors guillemets marque la fin de l'en-tête —
 * un contenu peut lui-même contenir des ":" (une URL, un TZID exotique). */
function splitProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

/** Déséchappement RFC 5545 §3.3.11. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

const PARIS_PARTS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * DTSTART → { date, time }.
 *
 * Trois formes du standard :
 *   20260912                → journée entière, pas d'heure
 *   20260912T150000         → heure locale (ou heure du TZID indiqué) : on la prend telle quelle
 *   20260912T130000Z        → UTC, à convertir
 *
 * La conversion UTC est faite, elle n'était pas faite avant ce chantier ("fuseau ignoré"). Un
 * Google Agenda et beaucoup d'exports fédéraux écrivent en UTC : ignorer le Z affichait 13:00 pour
 * un match de 15:00, et surtout faisait apparaître un faux "changement d'horaire" à chaque
 * comparaison avec une heure saisie à la main. Europe/Paris est le fuseau de référence de toute
 * l'app (clubs amateurs français, même hypothèse que club_calendar_events.event_time).
 */
function parseIcsDateTime(value: string, params: Record<string, string>): { date: string; time: string | null } | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm, , zulu] = match;
  if (!hh || !mm) return { date: `${y}-${m}-${d}`, time: null };
  if (params.VALUE === "DATE") return { date: `${y}-${m}-${d}`, time: null };

  if (zulu) {
    const utc = new Date(Date.UTC(+y!, +m! - 1, +d!, +hh, +mm));
    const parts = Object.fromEntries(PARIS_PARTS.formatToParts(utc).map((p) => [p.type, p.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
    };
  }
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

/** STATUS (RFC 5545 §3.8.1.11) : CONFIRMED / TENTATIVE / CANCELLED. TENTATIVE devient "unknown"
 * et non "postponed" — "pas encore confirmé" n'est pas "reporté", et inventer un report
 * déclencherait à tort la propagation vers `status='reportee'` côté base.
 *
 * `null` quand l'événement ne dit rien de son statut : ni propriété STATUS, ni mot-clé dans le
 * titre. Un calendrier muet ne doit pas repasser à "programmé" un match déjà joué (voir
 * SourceEvent.sportStatus). */
function icsStatusToSportStatus(raw: string | null, summary: string): SportStatus | null {
  if (raw) {
    const value = raw.trim().toUpperCase();
    if (value === "CANCELLED") return "cancelled";
    if (value === "TENTATIVE") return "unknown";
    if (value === "CONFIRMED") return "scheduled";
  }
  // Beaucoup d'exports n'écrivent pas STATUS et mettent l'information dans le titre
  // ("… - REPORTÉ"). On la lit, mais seulement comme repli : le champ standard prime.
  return detectSportStatus(summary);
}

function parseIcsTimestamp(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(raw.trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)).toISOString();
}

export function parseIcsSource(icsText: string): ParseResult {
  const lines = unfoldIcsLines(icsText);
  const events: SourceEvent[] = [];
  const issues: SourceIssue[] = [];

  let inEvent = false;
  let index = 0;
  let uid = "";
  let summary = "";
  let dtstart = "";
  let dtstartParams: Record<string, string> = {};
  let location = "";
  let status: string | null = null;
  let categories = "";
  let lastModified: string | undefined;
  let dtstamp: string | undefined;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      index += 1;
      uid = "";
      summary = "";
      dtstart = "";
      dtstartParams = {};
      location = "";
      status = null;
      categories = "";
      lastModified = undefined;
      dtstamp = undefined;
      continue;
    }

    if (line.startsWith("END:VEVENT")) {
      if (inEvent) {
        const title = summary || "Événement importé";
        const parsed = dtstart ? parseIcsDateTime(dtstart, dtstartParams) : null;
        if (!parsed) {
          issues.push({
            line: index,
            raw: title,
            reason: dtstart ? `Date de début illisible ("${dtstart}").` : "Événement sans DTSTART.",
          });
        } else {
          // Les deux côtés du titre sont conservés tels quels. Le moteur (diff.ts) décide ensuite
          // lequel est l'adversaire en s'appuyant sur les vraies équipes du club — jamais deviné
          // ici, où on ne les connaît pas.
          const sides = splitTitleSides(title);
          events.push({
            sourceLine: index,
            rawLabel: title,
            externalEventId: uid || null,
            externalCompetitionId: null,
            competitionName: categories ? unescapeText(categories) : null,
            externalTeamId: null,
            sourceTeamName: sides ? normalizeOpponentValue(sides.left) : null,
            opponent: normalizeOpponentValue(sides ? sides.right : title),
            matchDate: parsed.date,
            kickoffTime: parsed.time,
            location: location ? unescapeText(location) : null,
            isHome: null,
            sportStatus: icsStatusToSportStatus(status, title),
            score: null,
            sourceUpdatedAt: parseIcsTimestamp(lastModified) ?? parseIcsTimestamp(dtstamp),
          });
        }
      }
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    const prop = splitProperty(line);
    if (!prop) continue;
    if (prop.name === "UID") uid = prop.value.trim();
    else if (prop.name === "SUMMARY") summary = unescapeText(prop.value);
    else if (prop.name === "DTSTART") {
      dtstart = prop.value;
      dtstartParams = prop.params;
    } else if (prop.name === "LOCATION") location = prop.value;
    else if (prop.name === "STATUS") status = prop.value;
    else if (prop.name === "CATEGORIES") categories = prop.value;
    else if (prop.name === "LAST-MODIFIED") lastModified = prop.value;
    else if (prop.name === "DTSTAMP") dtstamp = prop.value;
  }

  return { events, issues };
}

export const icsProvider: CalendarProvider = {
  id: "ICS",
  label: "Fichier .ics (export fédéral, Google Agenda…)",
  accept: ".ics,text/calendar",
  needsColumnMapping: false,
  reads: "text",
  isReady: true,
  detect(fileName, head) {
    return fileName.toLowerCase().endsWith(".ics") || head.includes("BEGIN:VCALENDAR");
  },
  async parse(input: ProviderInput): Promise<ParseResult> {
    return parseIcsSource(input.text ?? "");
  },
};
