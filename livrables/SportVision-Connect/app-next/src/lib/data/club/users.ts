import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgUser } from "@/lib/types/settings";
import { mapClubRole } from "@/lib/supabase/mappers";

// club_members (migration-clubplus-v1.sql) — RLS : cm_member_select (is_club_member), écriture
// (rôle/statut) réservée à is_club_admin. Pas d'email réel exposé (auth.users n'est pas
// accessible via PostgREST) : laissé vide plutôt qu'inventé, voir le plan de migration.

interface ClubMemberRow {
  id: string;
  user_id: string;
  prenom: string | null;
  nom: string | null;
  role: string;
  status: string;
  created_at: string;
}

const STATUS_MAP: Record<string, OrgUser["status"]> = {
  actif: "active",
  invitation: "invited",
  suspendu: "disabled",
};

export async function fetchClubMembers(supabase: SupabaseClient, clubId: string): Promise<OrgUser[]> {
  const { data } = await supabase
    .from("club_members")
    .select("id, user_id, prenom, nom, role, status, created_at")
    .eq("club_id", clubId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as ClubMemberRow[]).map((row) => ({
    id: row.user_id,
    membershipId: row.id,
    firstName: row.prenom ?? "",
    lastName: row.nom ?? "",
    email: "",
    role: mapClubRole(row.role),
    teamScope: [],
    status: STATUS_MAP[row.status] ?? "active",
    invitedAt: row.status === "invitation" ? row.created_at : undefined,
  }));
}

/** Un admin peut suspendre/réactiver un autre membre (jamais lui-même) — écriture directe
 * autorisée par la policy is_club_admin, pas de RPC dédiée pour ce champ côté club_members. */
export async function setClubMemberStatus(
  supabase: SupabaseClient,
  membershipId: string,
  status: "actif" | "suspendu",
): Promise<void> {
  const { error } = await supabase.from("club_members").update({ status }).eq("id", membershipId);
  if (error) throw error;
}
