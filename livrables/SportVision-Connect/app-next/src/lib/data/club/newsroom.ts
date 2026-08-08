import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsroomItem, NewsroomStatus } from "@/lib/types/studio";

// club_newsroom_items (migration-clubplus-v3.sql) — workflow réel à 8 statuts, plus riche que
// les 5 de NewsroomStatus (design). Écriture par PATCH direct sur `status`, déjà le pattern en
// prod (club-newsroom-communication.js) — pas de RPC dédiée. RLS : is_club_member(club_id).

const STATUS_MAP: Record<string, NewsroomStatus> = {
  recu: "received",
  a_verifier: "to_process",
  infos_manquantes: "info_requested",
  pret_a_transformer: "to_process",
  en_creation: "transformed",
  programme: "transformed",
  publie: "transformed",
  archive: "archived",
};

/** Écriture — un seul statut réel par action design, pas de round-trip exact possible (8 réels
 * vers 5 design). Voir fetchClubNewsroomItems pour la lecture. */
const WRITE_STATUS_MAP: Record<"transformed" | "info_requested" | "archived", string> = {
  transformed: "en_creation",
  info_requested: "infos_manquantes",
  archived: "archive",
};

interface ClubNewsroomRow {
  id: string;
  team: string | null;
  title: string;
  description: string | null;
  author_id: string | null;
  author_name: string | null;
  status: string;
  created_at: string;
}

const SELECT = "id, team, title, description, author_id, author_name, status, created_at";

function toNewsroomItem(row: ClubNewsroomRow, organizationId: string): NewsroomItem {
  return {
    id: row.id,
    organizationId,
    title: row.title,
    body: row.description ?? "",
    submittedById: row.author_id ?? "",
    submittedByName: row.author_name ?? "Équipe",
    teamName: row.team ?? undefined,
    status: STATUS_MAP[row.status] ?? "received",
    createdAt: row.created_at,
  };
}

export async function fetchClubNewsroomItems(supabase: SupabaseClient, organizationId: string): Promise<NewsroomItem[]> {
  const { data } = await supabase
    .from("club_newsroom_items")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as ClubNewsroomRow[]).map((row) => toNewsroomItem(row, organizationId));
}

export async function updateClubNewsroomItemStatus(
  supabase: SupabaseClient,
  id: string,
  status: "transformed" | "info_requested" | "archived",
): Promise<void> {
  const { error } = await supabase
    .from("club_newsroom_items")
    .update({ status: WRITE_STATUS_MAP[status] })
    .eq("id", id);
  if (error) throw error;
}
