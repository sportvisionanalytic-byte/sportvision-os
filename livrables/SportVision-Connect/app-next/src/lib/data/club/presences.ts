import type { SupabaseClient } from "@supabase/supabase-js";
import type { PresenceKind, PresenceStatus } from "@/lib/types/communication";

// club_presences (migration-connect-v17-club-presences.sql) — lecture seule côté club : c'est
// SportVision qui planifie/valide une présence terrain, jamais le club lui-même (même logique que
// calendar_events pour les matchs). kind/status réutilisent PresenceKind/PresenceStatus
// (types/communication.ts) — même vocabulaire que la contrainte CHECK de club_presences.

export interface ClubPresence {
  id: string;
  eventLabel: string;
  date: string;
  kind: PresenceKind;
  operatorName: string | null;
  status: PresenceStatus;
}

interface PresenceRow {
  id: string;
  event_label: string;
  event_date: string;
  kind: string;
  operator_name: string | null;
  status: string;
}

export async function fetchClubPresences(supabase: SupabaseClient, organizationId: string): Promise<ClubPresence[]> {
  const { data, error } = await supabase
    .from("club_presences")
    .select("id, event_label, event_date, kind, operator_name, status")
    .eq("organization_id", organizationId)
    .order("event_date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PresenceRow[]).map((row) => ({
    id: row.id,
    eventLabel: row.event_label,
    date: row.event_date,
    kind: row.kind as PresenceKind,
    operatorName: row.operator_name,
    status: row.status as PresenceStatus,
  }));
}
