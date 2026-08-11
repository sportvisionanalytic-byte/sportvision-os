import type { SupabaseClient } from "@supabase/supabase-js";

// Demande d'adhésion à une équipe, côté joueur déjà affilié (player_profiles + compte auth déjà
// existants — voir session.ts:buildPlayerActiveContext, un espace Joueur n'existe qu'une fois la
// fiche créée). Réutilise request_team_membership_as_player telle quelle (migration-clubplus-
// v14/v15.sql) : appelée sans prenom/nom/date_naissance (déjà connus, la fonction ne les redemande
// que pour la toute première demande d'un compte sans fiche). Liste des équipes disponibles via
// club_teams, policy ctm_family_club_select (migration-connect-v26.sql).

export interface JoinableTeam {
  id: string;
  name: string;
  categorie: string | null;
}

export interface MyJoinRequest {
  id: string;
  teamName: string | null;
  statut: string;
  createdAt: string;
  refusMotif: string | null;
}

export async function fetchJoinableTeams(supabase: SupabaseClient, clubId: string): Promise<JoinableTeam[]> {
  const { data, error } = await supabase.from("club_teams").select("id, name, categorie").eq("club_id", clubId).order("name");
  if (error) throw error;
  return (data ?? []) as JoinableTeam[];
}

interface MyRequestRow {
  id: string;
  statut: string;
  created_at: string;
  refus_motif: string | null;
  club_teams: { name: string } | null;
}

export async function fetchMyJoinRequests(supabase: SupabaseClient, playerId: string): Promise<MyJoinRequest[]> {
  const { data, error } = await supabase
    .from("membership_requests")
    .select("id, statut, created_at, refus_motif, club_teams(name)")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as MyRequestRow[]).map((row) => ({
    id: row.id,
    teamName: row.club_teams?.name ?? null,
    statut: row.statut,
    createdAt: row.created_at,
    refusMotif: row.refus_motif,
  }));
}

export async function requestTeamMembershipAsPlayer(
  supabase: SupabaseClient,
  params: { clubId: string; teamId: string; inviteCode?: string },
): Promise<void> {
  const { error } = await supabase.rpc("request_team_membership_as_player", {
    p_club_id: params.clubId,
    p_team_id: params.teamId,
    p_invite_code: params.inviteCode ?? null,
  });
  if (error) throw error;
}
