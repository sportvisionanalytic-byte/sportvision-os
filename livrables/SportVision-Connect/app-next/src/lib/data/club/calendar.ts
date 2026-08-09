import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventKind } from "@/lib/types/calendar";
import { MATCH_STATUS_LABELS } from "@/lib/types/studio";
import { STATUS_MAP as MATCH_STATUS_MAP } from "./matches";

// Vue agrégée — voir le plan Phase 1 § Remplacement module par module. club_calendar_events
// (migration-clubplus-v4.sql) est une source parmi d'autres ; club_matches (v3) en est une
// deuxième (un match programmé est aussi un événement de calendrier). RLS : is_club_member(club_id)
// pour les deux tables.

const EVENT_TYPE_MAP: Record<string, CalendarEventKind> = {
  match: "match",
  entrainement: "training",
  tournoi: "event",
  contenu: "shoot",
  sponsor: "meeting",
  prestation: "service",
};

/**
 * club_calendar_events.type (contrainte check, migration-clubplus-v4.sql) n'accepte que ces 6
 * valeurs — les 4 autres CalendarEventKind du design (publication, contract_deadline,
 * invoice_deadline, camp) n'ont pas d'équivalent réel et ne doivent jamais être proposées à la
 * création (voir AddEventModal.tsx, qui filtre son <select> sur les clés de ce map).
 */
export const CREATABLE_EVENT_TYPE_MAP: Record<string, string> = {
  match: "match",
  training: "entrainement",
  event: "tournoi",
  shoot: "contenu",
  meeting: "sponsor",
  service: "prestation",
};

interface ClubCalendarEventRow {
  id: string;
  event_date: string;
  type: string;
  title: string;
  team: string | null;
}

interface ClubMatchRow {
  id: string;
  team: string;
  opponent: string;
  match_date: string | null;
  lieu: string | null;
  status: string;
}

export async function fetchClubCalendarEvents(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<CalendarEvent[]> {
  const [eventsRes, matchesRes] = await Promise.all([
    supabase
      .from("club_calendar_events")
      .select("id, event_date, type, title, team")
      .eq("club_id", organizationId),
    supabase
      .from("club_matches")
      .select("id, team, opponent, match_date, lieu, status")
      .eq("club_id", organizationId),
  ]);

  const events: CalendarEvent[] = ((eventsRes.data ?? []) as ClubCalendarEventRow[]).map((row) => ({
    id: `event-${row.id}`,
    organizationId,
    kind: EVENT_TYPE_MAP[row.type] ?? "event",
    title: row.title,
    startsAt: row.event_date,
    allDay: true,
    teamName: row.team ?? undefined,
  }));

  const matches: CalendarEvent[] = ((matchesRes.data ?? []) as ClubMatchRow[])
    .filter((row) => row.match_date)
    .map((row) => ({
      id: `match-${row.id}`,
      organizationId,
      kind: "match",
      title: `${row.team} vs ${row.opponent}`,
      startsAt: row.match_date!,
      allDay: true,
      location: row.lieu ?? undefined,
      teamName: row.team,
      sourceHref: "/matchcenter",
      // Traduit le statut brut (a_venir/a_transmettre/recu) via le même mapping que Match Center
      // (MATCH_STATUS_LABELS) — voir EventDetailPanel.tsx, qui affiche event.status tel quel.
      status: MATCH_STATUS_LABELS[MATCH_STATUS_MAP[row.status] ?? "upcoming"],
    }));

  return [...events, ...matches];
}

export async function createClubCalendarEvent(
  supabase: SupabaseClient,
  organizationId: string,
  input: { title: string; kind: CalendarEventKind; date: string },
): Promise<CalendarEvent> {
  const type = CREATABLE_EVENT_TYPE_MAP[input.kind] ?? "contenu";

  const { data, error } = await supabase
    .from("club_calendar_events")
    .insert({ club_id: organizationId, event_date: input.date, type, title: input.title })
    .select("id, event_date, type, title, team")
    .single();
  if (error || !data) throw error ?? new Error("Création de l'événement impossible.");

  const row = data as ClubCalendarEventRow;
  return {
    id: `event-${row.id}`,
    organizationId,
    kind: EVENT_TYPE_MAP[row.type] ?? "event",
    title: row.title,
    startsAt: row.event_date,
    allDay: true,
    teamName: row.team ?? undefined,
  };
}
