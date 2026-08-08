import type { SupabaseClient } from "@supabase/supabase-js";
import type { Team } from "@/lib/types/teams";

// academie_groups/academie_participants (migration-connect-v3-coach-academie-requests.sql) —
// un groupe académie a la même forme conceptuelle qu'une équipe club (nom, niveau, coach,
// effectif) : réutilise le type Team/TeamCard du design plutôt que d'en inventer un nouveau.
// RLS : is_org_member (CRUD complet) ou is_staff.

interface GroupRow {
  id: string;
  nom: string;
  niveau: string | null;
  coach_name: string | null;
}

export async function fetchAcademieGroups(supabase: SupabaseClient, organizationId: string): Promise<Team[]> {
  const [groupsRes, participantsRes] = await Promise.all([
    supabase.from("academie_groups").select("id, nom, niveau, coach_name").eq("organization_id", organizationId).order("nom"),
    supabase.from("academie_participants").select("group_id").eq("organization_id", organizationId),
  ]);

  const countByGroup = new Map<string, number>();
  for (const row of (participantsRes.data ?? []) as { group_id: string | null }[]) {
    if (!row.group_id) continue;
    countByGroup.set(row.group_id, (countByGroup.get(row.group_id) ?? 0) + 1);
  }

  return ((groupsRes.data ?? []) as GroupRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.nom,
    category: row.niveau ?? "—",
    season: "",
    headCoachName: row.coach_name ?? "—",
    playerCount: countByGroup.get(row.id) ?? 0,
  }));
}

export async function addAcademieGroup(
  supabase: SupabaseClient,
  organizationId: string,
  input: { name: string; niveau?: string; coachName?: string },
): Promise<Team> {
  const { data, error } = await supabase
    .from("academie_groups")
    .insert({ organization_id: organizationId, nom: input.name, niveau: input.niveau ?? null, coach_name: input.coachName ?? null })
    .select("id, nom, niveau, coach_name")
    .single();
  if (error || !data) throw error ?? new Error("Création du groupe impossible.");
  const row = data as GroupRow;
  return { id: row.id, organizationId, name: row.nom, category: row.niveau ?? "—", season: "", headCoachName: row.coach_name ?? "—", playerCount: 0 };
}
