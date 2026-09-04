// Compatibilité — les parseurs de calendrier ont déménagé.
//
// 05/09/2026, phase TypeScript du chantier "calendriers externes". Ce fichier contenait les deux
// parseurs ICS et CSV. Ils vivent désormais dans src/lib/calendar/providers/ derrière l'interface
// commune `CalendarProvider`, aux côtés du lecteur .xlsx, du moteur de diff et de la couche de
// synchronisation. Trois choses ont changé et ne peuvent pas être exprimées par l'ancien type
// `ImportedMatchRow` :
//
//   * l'IDENTITÉ. L'ICS expose maintenant son UID et le CSV sa colonne `id` : ils deviennent
//     `club_matches.external_event_id`, ce qui fait qu'un match dont la date ou l'heure change est
//     reconnu comme le même match et mis à jour, au lieu de créer un doublon ;
//   * l'HEURE, qui n'était plus "purement indicative" (le commentaire d'origine disait vrai à
//     l'époque : club_matches n'avait pas de colonne heure) mais fait maintenant partie de la clé
//     d'unicité de repli ;
//   * le STATUT SPORTIF (reporté / annulé / joué), lu depuis STATUS en ICS et depuis une colonne
//     dédiée en CSV.
//
// Ce module reste exporté et fonctionnel pour ne casser aucun appelant, mais il ne contient plus
// aucune logique propre : tout passe par les providers. Un nouvel écran doit importer
// `@/lib/calendar/providers` et le moteur (`@/lib/calendar/diff`), pas ce fichier.

import { parseCsvSource } from "./calendar/providers/csv.ts";
import { parseIcsSource } from "./calendar/providers/ics.ts";
import type { SourceEvent } from "./calendar/types.ts";

export interface ImportedMatchRow {
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  location: string | null;
  suggestedOpponent: string;
}

function toLegacyRow(event: SourceEvent): ImportedMatchRow {
  return {
    title: event.rawLabel,
    date: event.matchDate,
    time: event.kickoffTime,
    location: event.location,
    suggestedOpponent: event.opponent,
  };
}

/** @deprecated Utiliser `icsProvider.parse()` : cette forme perd l'UID, le statut et la
 * compétition, donc l'identité stable du match. */
export function parseIcsEvents(icsText: string): ImportedMatchRow[] {
  return parseIcsSource(icsText).events.map(toLegacyRow);
}

/** @deprecated Utiliser `csvProvider.parse()` — voir ci-dessus. */
export function parseMatchesCsv(csvText: string): ImportedMatchRow[] {
  return parseCsvSource(csvText).events.map(toLegacyRow);
}
