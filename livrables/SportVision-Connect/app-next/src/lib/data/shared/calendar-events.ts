import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventKind } from "@/lib/types/calendar";

// calendar_events générique (migration-connect-v3-coach-academie-requests.sql), réutilisé par
// Coach, Académie et Sponsor — voir le plan Phase 4. Lecture seule côté membre (écriture
// réservée au staff SportVision, policy cal_staff_write — contrairement à
// club_calendar_events qui autorise l'insertion par un membre). `type` est un texte libre sans
// contrainte : mapping best-effort, repli sur "event" si non reconnu.

const EVENT_TYPE_MAP: Record<string, CalendarEventKind> = {
  contenu: "shoot",
  match: "match",
  entrainement: "training",
  tournoi: "event",
  sponsor: "meeting",
  prestation: "service",
  stage: "camp",
  reunion: "meeting",
};

interface CalendarEventRow {
  id: string;
  event_date: string;
  type: string;
  title: string;
  context: string | null;
}

export async function fetchOrgCalendarEvents(supabase: SupabaseClient, organizationId: string): Promise<CalendarEvent[]> {
  const { data } = await supabase
    .from("calendar_events")
    .select("id, event_date, type, title, context")
    .eq("organization_id", organizationId)
    .order("event_date", { ascending: true });

  return ((data ?? []) as CalendarEventRow[]).map((row) => ({
    id: row.id,
    organizationId,
    kind: EVENT_TYPE_MAP[row.type] ?? "event",
    title: row.title,
    startsAt: row.event_date,
    allDay: true,
    teamName: row.context ?? undefined,
  }));
}
