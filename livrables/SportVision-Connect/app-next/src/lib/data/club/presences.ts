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
  /** « HH:MM », quand l'événement a une heure. */
  heure: string | null;
  kind: PresenceKind;
  /** photo, video, photo_video — ce que SportVision couvre. */
  typeCouverture: string | null;
  operatorName: string | null;
  status: PresenceStatus;
  missionReference: string | null;
}

interface PresenceRow {
  id: string;
  event_label: string;
  event_date: string;
  heure: string | null;
  kind: string;
  type_couverture: string | null;
  operator_name: string | null;
  status: string;
  mission_reference: string | null;
}

// 11/09/2026 : les présences sont celles que le CM décide (planned_presences, v126), lues par
// club_presences_sportvision (v140). `club_presences` (connect-v17) n'est plus alimentée : la page
// affichait « Aucune présence programmée » à côté d'une carte « 8 prévues ».
export async function fetchClubPresences(supabase: SupabaseClient, organizationId: string): Promise<ClubPresence[]> {
  const { data, error } = await supabase.rpc("club_presences_sportvision", { p_club_id: organizationId });
  if (error) throw error;
  return ((data ?? []) as PresenceRow[]).map((row) => ({
    id: row.id,
    eventLabel: row.event_label,
    date: row.event_date,
    heure: row.heure ? row.heure.slice(0, 5) : null,
    kind: row.kind as PresenceKind,
    typeCouverture: row.type_couverture,
    operatorName: row.operator_name,
    status: row.status as PresenceStatus,
    missionReference: row.mission_reference,
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
  // Même source que la page Présences (v140), plus l'ancienne table vide.
  const presences = await fetchClubPresences(supabase, organizationId);
  // Une mission regroupée (v133) est une seule présence, quel que soit le nombre de matchs.
  const faites = presences.filter((p) => p.status === "completed" && p.date >= monthStart);
  return new Set(faites.map((p) => p.missionReference ?? p.id)).size;
}
