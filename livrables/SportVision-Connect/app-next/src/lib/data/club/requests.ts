import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisualFormat, VisualPlatform, VisualRequest, VisualRequestStatus, VisualRequestUrgency, VisualType } from "@/lib/types/studio";
import { VISUAL_TYPE_LABELS } from "@/lib/types/studio";

// club_requests (migration-clubplus-v4.sql) — écriture EXCLUSIVEMENT via RPC (jamais de PATCH/
// UPDATE direct sur statut/crédits, voir migration-connect-v1-securite-hardening.sql) :
// - submit_club_request(p_club_id, p_team, p_type, p_urgency, p_detail, p_credits) — création.
// - update_club_request_status(p_request_id, p_status) — un membre club ne peut QUE annuler
//   ('refusee') une demande encore 'recues' ; toute autre transition est staff-only (RPC le
//   vérifie elle-même et lève une exception sinon, pas la peine de le revérifier ici).
//
// Pas de colonne réelle pour publishDate/format/platform/attachments (voir le plan Phase 1) :
// `type` (texte libre, sans contrainte) stocke directement la clé VisualType — round-trip fidèle
// pour les demandes créées depuis Next.js, dégradé en "other" pour celles de l'app vanilla
// (texte français libre, ne correspondra à aucune clé). RLS : is_club_member(club_id).

const STATUS_MAP: Record<string, VisualRequestStatus> = {
  recues: "Envoyée",
  info_manquante: "À compléter",
  en_traitement: "En traitement",
  prete_a_creer: "Acceptée",
  terminee: "Terminée",
  refusee: "Refusée",
};

const URGENCY_READ_MAP: Record<string, VisualRequestUrgency> = {
  normale: "standard",
  haute: "priority",
};

const URGENCY_WRITE_MAP: Record<VisualRequestUrgency, string> = {
  standard: "normale",
  priority: "haute",
  express: "haute",
};

const VISUAL_TYPE_KEYS = new Set(Object.keys(VISUAL_TYPE_LABELS));

interface ClubRequestRow {
  id: string;
  team: string | null;
  type: string;
  requester_id: string | null;
  requester_name: string | null;
  status: string;
  urgency: string;
  detail: string | null;
  credits_reserved: number;
  created_at: string;
}

const SELECT = "id, team, type, requester_id, requester_name, status, urgency, detail, credits_reserved, created_at";

function toVisualRequest(row: ClubRequestRow, organizationId: string): VisualRequest {
  const visualType = (VISUAL_TYPE_KEYS.has(row.type) ? row.type : "other") as VisualType;
  return {
    id: row.id,
    reference: `VIS-${row.id.slice(0, 8).toUpperCase()}`,
    organizationId,
    requestedById: row.requester_id ?? "",
    requestedByName: row.requester_name ?? "—",
    visualType,
    teamName: row.team ?? undefined,
    // Pas de colonne réelle — valeurs par défaut documentées ci-dessus.
    publishDate: row.created_at,
    format: "post_1_1" as VisualFormat,
    platform: "instagram" as VisualPlatform,
    bodyText: row.detail ?? undefined,
    status: STATUS_MAP[row.status] ?? "Envoyée",
    revisionCount: 0,
    dueAt: row.created_at,
    urgency: URGENCY_READ_MAP[row.urgency] ?? "standard",
    creditsReserved: row.credits_reserved,
    attachments: [],
    createdAt: row.created_at,
  } as VisualRequest;
}

export async function fetchClubRequests(supabase: SupabaseClient, organizationId: string): Promise<VisualRequest[]> {
  const { data, error } = await supabase
    .from("club_requests")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as ClubRequestRow[]).map((row) => toVisualRequest(row, organizationId));
}

export async function submitClubRequest(
  supabase: SupabaseClient,
  organizationId: string,
  input: { visualType: VisualType; teamName?: string; bodyText?: string; urgency: VisualRequestUrgency; credits: number },
): Promise<VisualRequest> {
  const { data, error } = await supabase.rpc("submit_club_request", {
    p_club_id: organizationId,
    p_team: input.teamName ?? null,
    p_type: input.visualType,
    p_urgency: URGENCY_WRITE_MAP[input.urgency],
    p_detail: input.bodyText ?? null,
    p_credits: input.credits,
  });
  if (error || !data) throw error ?? new Error("Envoi de la demande impossible.");
  return toVisualRequest(data as ClubRequestRow, organizationId);
}

/** Un membre club ne peut annuler qu'une demande encore 'recues' (Envoyée) — la RPC lève une
 * exception dans tout autre cas, propagée telle quelle à l'appelant. */
export async function cancelClubRequest(supabase: SupabaseClient, requestId: string, organizationId: string): Promise<VisualRequest> {
  const { data, error } = await supabase.rpc("update_club_request_status", {
    p_request_id: requestId,
    p_status: "refusee",
  });
  if (error || !data) throw error ?? new Error("Annulation impossible.");
  return toVisualRequest(data as ClubRequestRow, organizationId);
}
