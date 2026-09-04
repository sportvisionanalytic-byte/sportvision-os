import type { SupabaseClient } from "@supabase/supabase-js";

// coverage_wishes (migration-coverage-wishes-e24-e25.sql, audit transversal 04/09/2026) — le
// club signale un événement, jamais une mission : SELECTED crée une vraie planned_presences côté
// SportVision, jamais d'assignation opérateur automatique depuis ici. UI construite le 05/09/2026
// (priorité remontée par Fouka en post-audit, backend déjà complet mais sans écran depuis 4
// jours) — voir create_coverage_wishes (RPC, gère l'idempotence bulk et les notifications CM).

export type CoverageType = "photo" | "video" | "photo_video" | "interview" | "autre";
export type CoveragePriority = "forte" | "normale" | "optionnelle";
export type CoverageWishStatus =
  | "wished"
  | "reviewing"
  | "selected"
  | "not_selected"
  | "sent_to_production"
  | "production_confirmed"
  | "completed"
  | "cancelled";

export const COVERAGE_TYPE_LABELS: Record<CoverageType, string> = {
  photo: "Photo",
  video: "Vidéo",
  photo_video: "Photo + vidéo",
  interview: "Interview / coulisses",
  autre: "Autre",
};

export const COVERAGE_PRIORITY_LABELS: Record<CoveragePriority, string> = {
  forte: "Forte",
  normale: "Normale",
  optionnelle: "Optionnelle",
};

// Statut club uniquement (§31, jamais un statut Production interne) : sent_to_production et
// production_confirmed sont tous deux "Planifiée" du point de vue du club — la distinction entre
// "envoyé à la production" et "confirmé par un opérateur" n'a pas de valeur pour un président, qui
// veut seulement savoir si SportVision vient ou pas.
export const COVERAGE_WISH_STATUS_LABELS: Record<CoverageWishStatus, string> = {
  wished: "Souhaitée",
  reviewing: "En étude",
  selected: "Planifiée",
  sent_to_production: "Planifiée",
  production_confirmed: "Planifiée",
  not_selected: "Non retenue",
  completed: "Terminée",
  cancelled: "Annulée",
};

export type CoverageWishBadgeTone = "success" | "warning" | "danger" | "info" | "accent" | "cyan" | "neutral";

export const COVERAGE_WISH_STATUS_TONE: Record<CoverageWishStatus, CoverageWishBadgeTone> = {
  wished: "info",
  reviewing: "warning",
  selected: "accent",
  sent_to_production: "accent",
  production_confirmed: "accent",
  not_selected: "neutral",
  completed: "success",
  cancelled: "neutral",
};

export interface CoverageWish {
  id: string;
  clubId: string;
  matchId: string | null;
  calendarEventId: string | null;
  coverageType: CoverageType;
  priority: CoveragePriority;
  note: string | null;
  status: CoverageWishStatus;
  notSelectedReason: string | null;
  createdAt: string;
}

interface CoverageWishRow {
  id: string;
  club_id: string;
  match_id: string | null;
  calendar_event_id: string | null;
  requested_coverage_type: string;
  priority: string;
  note: string | null;
  status: string;
  not_selected_reason: string | null;
  created_at: string;
}

function toCoverageWish(row: CoverageWishRow): CoverageWish {
  return {
    id: row.id,
    clubId: row.club_id,
    matchId: row.match_id,
    calendarEventId: row.calendar_event_id,
    coverageType: row.requested_coverage_type as CoverageType,
    priority: row.priority as CoveragePriority,
    note: row.note,
    status: row.status as CoverageWishStatus,
    notSelectedReason: row.not_selected_reason,
    createdAt: row.created_at,
  };
}

export async function fetchCoverageWishes(supabase: SupabaseClient, clubId: string): Promise<CoverageWish[]> {
  const { data, error } = await supabase
    .from("coverage_wishes")
    .select("id, club_id, match_id, calendar_event_id, requested_coverage_type, priority, note, status, not_selected_reason, created_at")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as CoverageWishRow[]).map(toCoverageWish);
}

export interface CoverageWishItemInput {
  matchId?: string;
  calendarEventId?: string;
  coverageType: CoverageType;
  priority: CoveragePriority;
  note?: string;
}

/** Un seul appel pour toute la sélection (bulk) : create_coverage_wishes gère l'idempotence par
 * événement elle-même (ON CONFLICT), un double-clic ou un double-submit ne crée jamais de doublon. */
export async function createCoverageWishes(
  supabase: SupabaseClient,
  clubId: string,
  items: CoverageWishItemInput[],
): Promise<CoverageWish[]> {
  const payload = items.map((it) => ({
    match_id: it.matchId ?? null,
    calendar_event_id: it.calendarEventId ?? null,
    coverage_type: it.coverageType,
    priority: it.priority,
    note: it.note ?? null,
  }));
  const { data, error } = await supabase.rpc("create_coverage_wishes", { p_club_id: clubId, p_items: payload });
  if (error) throw error;
  return ((data ?? []) as CoverageWishRow[]).map(toCoverageWish);
}

export async function cancelCoverageWish(supabase: SupabaseClient, wishId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_coverage_wish", { p_wish_id: wishId });
  if (error) throw error;
}
