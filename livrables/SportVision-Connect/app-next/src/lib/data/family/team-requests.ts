import type { SupabaseClient } from "@supabase/supabase-js";

// Demande d'adhésion à une équipe pour un enfant DÉJÀ affilié (parent_player_relationships
// confirmé, voir data/family/children.ts) — RPC request_team_membership_for_existing_child
// (migration-connect-v26.sql), qui comble le manque laissé par request_team_membership_for_child
// (v14 : toujours créé une nouvelle fiche joueur, jamais adapté à un enfant déjà connu). Liste des
// équipes disponibles via club_teams, policy ctm_family_club_select (même migration).

import type { JoinableTeam, MyJoinRequest } from "@/lib/data/player/team-requests";

export type { JoinableTeam, MyJoinRequest };

export async function fetchJoinableTeamsForClub(supabase: SupabaseClient, clubId: string): Promise<JoinableTeam[]> {
  const { data, error } = await supabase.from("club_teams").select("id, name, categorie").eq("club_id", clubId).order("name");
  if (error) throw error;
  return (data ?? []) as JoinableTeam[];
}

interface ChildRequestRow {
  id: string;
  statut: string;
  created_at: string;
  refus_motif: string | null;
  club_teams: { name: string } | null;
}

export async function fetchChildJoinRequests(supabase: SupabaseClient, playerId: string): Promise<MyJoinRequest[]> {
  const { data, error } = await supabase
    .from("membership_requests")
    .select("id, statut, created_at, refus_motif, club_teams(name)")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as ChildRequestRow[]).map((row) => ({
    id: row.id,
    teamName: row.club_teams?.name ?? null,
    statut: row.statut,
    createdAt: row.created_at,
    refusMotif: row.refus_motif,
  }));
}

export async function requestTeamMembershipForChild(
  supabase: SupabaseClient,
  params: { playerId: string; teamId: string; inviteCode?: string },
): Promise<void> {
  const { error } = await supabase.rpc("request_team_membership_for_existing_child", {
    p_player_id: params.playerId,
    p_team_id: params.teamId,
    p_invite_code: params.inviteCode ?? null,
  });
  if (error) throw error;
}
