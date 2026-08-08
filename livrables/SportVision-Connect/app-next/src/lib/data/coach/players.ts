import type { SupabaseClient } from "@supabase/supabase-js";

// coach_players (migration-connect-v3-coach-academie-requests.sql) — roster minimal d'un coach
// indépendant (pas de lien avec player_profiles/club_teams, table à part). RLS : is_org_member
// (CRUD complet, policy "for all") ou is_staff.

export interface CoachPlayer {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string | null;
  category: string | null;
  notes: string | null;
}

interface CoachPlayerRow {
  id: string;
  prenom: string;
  nom: string | null;
  categorie: string | null;
  notes: string | null;
}

export async function fetchCoachPlayers(supabase: SupabaseClient, organizationId: string): Promise<CoachPlayer[]> {
  const { data } = await supabase
    .from("coach_players")
    .select("id, prenom, nom, categorie, notes")
    .eq("organization_id", organizationId)
    .order("nom", { ascending: true });

  return ((data ?? []) as CoachPlayerRow[]).map((row) => ({
    id: row.id,
    organizationId,
    firstName: row.prenom,
    lastName: row.nom,
    category: row.categorie,
    notes: row.notes,
  }));
}

export async function addCoachPlayer(
  supabase: SupabaseClient,
  organizationId: string,
  input: { firstName: string; lastName?: string; category?: string; notes?: string },
): Promise<CoachPlayer> {
  const { data, error } = await supabase
    .from("coach_players")
    .insert({ organization_id: organizationId, prenom: input.firstName, nom: input.lastName ?? null, categorie: input.category ?? null, notes: input.notes ?? null })
    .select("id, prenom, nom, categorie, notes")
    .single();
  if (error || !data) throw error ?? new Error("Ajout du joueur impossible.");
  const row = data as CoachPlayerRow;
  return { id: row.id, organizationId, firstName: row.prenom, lastName: row.nom, category: row.categorie, notes: row.notes };
}
