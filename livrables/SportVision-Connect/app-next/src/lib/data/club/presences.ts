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

/** Présences réalisées ce mois-ci — /accompagnement « Le mois en cours » (Tier C Phase 3,
 * 10/08/2026). Remplace `ctx.subscription.presencesUsed`, toujours 0 en dur côté session.ts (non
 * tracké à ce niveau, voir le commentaire de /presences) — ici un vrai comptage sur
 * club_presences (status='completed', event_date dans le mois courant), RLS `cpr_member_select`
 * (is_org_member) sans dépendre d'un entitlement actif. */
export async function fetchClubPresencesThisMonth(supabase: SupabaseClient, organizationId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from("club_presences")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "completed")
    .gte("event_date", monthStart);
  if (error) throw error;
  return count ?? 0;
}
