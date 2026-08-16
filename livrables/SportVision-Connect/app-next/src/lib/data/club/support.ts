import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportTicket, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/lib/types/settings";

// club_support_tickets (migration-clubplus-v11.sql, étendue par migration-clubplus-v39.sql) — 4
// statuts réels (ouvert/en_cours/reponse_disponible/resolu), pas de priorité ni d'assigné
// trackés en base, catégorie en texte libre. Aucune policy UPDATE pour un membre club (seul
// `is_club_admin` peut delete) — voir le plan Phase 1 § Gaps de données : pas de bouton de
// résolution côté club, confirmé par l'absence de policy — le passage à 'reponse_disponible'
// est donc écrit par SportVision OS, jamais par ce fichier. RLS : is_club_member(club_id) pour
// select/insert. 'closed' (SupportTicketStatus) reste hors périmètre : aucune valeur DB
// équivalente n'existe encore, voir CLUB-PLUS-PRODUCT-BIBLE.md §21.
const STATUS_MAP: Record<string, SupportTicketStatus> = {
  ouvert: "open",
  en_cours: "in_progress",
  reponse_disponible: "response_available",
  resolu: "resolved",
};

const CATEGORY_VALUES: SupportTicketCategory[] = ["content", "billing", "technical", "contract", "account", "other"];

interface ClubSupportTicketRow {
  id: string;
  subject: string;
  category: string | null;
  message: string | null;
  status: string;
  created_by: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

function toTicket(row: ClubSupportTicketRow, organizationId: string): SupportTicket {
  const category = CATEGORY_VALUES.find((c) => c === row.category) ?? "other";
  return {
    id: row.id,
    reference: `TCK-${row.id.slice(0, 8).toUpperCase()}`,
    organizationId,
    createdById: row.created_by ?? "",
    subject: row.subject,
    category,
    priority: "normal",
    description: row.message ?? "",
    status: STATUS_MAP[row.status] ?? "open",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = "id, subject, category, message, status, created_by, author_name, created_at, updated_at";

export async function fetchClubSupportTickets(supabase: SupabaseClient, organizationId: string): Promise<SupportTicket[]> {
  const { data } = await supabase
    .from("club_support_tickets")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as ClubSupportTicketRow[]).map((row) => toTicket(row, organizationId));
}

export async function createClubSupportTicket(
  supabase: SupabaseClient,
  organizationId: string,
  authorName: string,
  input: { subject: string; category: SupportTicketCategory; priority: SupportTicketPriority; description: string },
): Promise<SupportTicket> {
  const { data, error } = await supabase
    .from("club_support_tickets")
    .insert({ club_id: organizationId, subject: input.subject, category: input.category, message: input.description, author_name: authorName })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error("Création du ticket impossible.");
  return toTicket(data as ClubSupportTicketRow, organizationId);
}
