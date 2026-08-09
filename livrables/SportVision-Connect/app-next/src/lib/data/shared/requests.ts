import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisualFormat, VisualPlatform, VisualRequest, VisualRequestStatus, VisualRequestUrgency, VisualType } from "@/lib/types/studio";
import { VISUAL_TYPE_LABELS } from "@/lib/types/studio";

// requests/calendar_events génériques (migration-connect-v3-coach-academie-requests.sql),
// réutilisés tels quels par Coach, Académie et Sponsor (organization_id-scoped) — voir le plan
// Phase 4. Même modèle que club_requests (Phase 1) mais SANS colonne `team`, et écriture via
// submit_request/update_request_status (pas les RPC *_club_*). RLS : is_org_member/is_staff.

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

interface RequestRow {
  id: string;
  type: string;
  requester_id: string | null;
  requester_name: string | null;
  status: string;
  urgency: string;
  detail: string | null;
  credits_reserved: number;
  created_at: string;
}

const SELECT = "id, type, requester_id, requester_name, status, urgency, detail, credits_reserved, created_at";

function toVisualRequest(row: RequestRow, organizationId: string): VisualRequest {
  const visualType = (VISUAL_TYPE_KEYS.has(row.type) ? row.type : "other") as VisualType;
  return {
    id: row.id,
    reference: `REQ-${row.id.slice(0, 8).toUpperCase()}`,
    organizationId,
    requestedById: row.requester_id ?? "",
    requestedByName: row.requester_name ?? "—",
    visualType,
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
  };
}

export async function fetchOrgRequests(supabase: SupabaseClient, organizationId: string): Promise<VisualRequest[]> {
  const { data, error } = await supabase
    .from("requests")
    .select(SELECT)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as RequestRow[]).map((row) => toVisualRequest(row, organizationId));
}

export async function submitOrgRequest(
  supabase: SupabaseClient,
  organizationId: string,
  input: { visualType: VisualType; bodyText?: string; urgency: VisualRequestUrgency; credits: number },
): Promise<VisualRequest> {
  const { data, error } = await supabase.rpc("submit_request", {
    p_organization_id: organizationId,
    p_type: input.visualType,
    p_urgency: URGENCY_WRITE_MAP[input.urgency],
    p_detail: input.bodyText ?? null,
    p_credits: input.credits,
  });
  if (error || !data) throw error ?? new Error("Envoi de la demande impossible.");
  return toVisualRequest(data as RequestRow, organizationId);
}

/** Un membre ne peut annuler qu'une demande encore 'recues' (Envoyée) — la RPC lève une
 * exception dans tout autre cas. */
export async function cancelOrgRequest(supabase: SupabaseClient, requestId: string, organizationId: string): Promise<VisualRequest> {
  const { data, error } = await supabase.rpc("update_request_status", {
    p_request_id: requestId,
    p_status: "refusee",
  });
  if (error || !data) throw error ?? new Error("Annulation impossible.");
  return toVisualRequest(data as RequestRow, organizationId);
}
