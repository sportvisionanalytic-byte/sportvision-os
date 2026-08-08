import type { SupabaseClient } from "@supabase/supabase-js";
import type { Team } from "@/lib/types/teams";

// club_teams (migration-clubplus-v5.sql) : résumé d'équipe (nom, catégorie, coach, effectif en
// nombre) — pas de roster nominatif de joueurs (pas de table club_players). RLS : ctm_member_select
// via is_club_member(club_id). Voir le plan Phase 1 § Gaps de données : /teams/[id] reste
// verrouillé jusqu'à la Phase 2 (Joueur & Famille).

interface ClubTeamRow {
  id: string;
  name: string;
  categorie: string | null;
  coach: string | null;
  members: number | null;
}

export async function fetchClubTeams(supabase: SupabaseClient, organizationId: string): Promise<Team[]> {
  const [teamsRes, clubRes] = await Promise.all([
    supabase
      .from("club_teams")
      .select("id, name, categorie, coach, members")
      .eq("club_id", organizationId)
      .order("name"),
    supabase.from("clubs").select("saison").eq("id", organizationId).maybeSingle(),
  ]);

  const season = (clubRes.data as { saison: string } | null)?.saison ?? "";

  return ((teamsRes.data ?? []) as ClubTeamRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.name,
    category: row.categorie ?? "—",
    season,
    headCoachName: row.coach ?? "—",
    playerCount: row.members ?? 0,
  }));
}
