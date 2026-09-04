import type { SupabaseClient } from "@supabase/supabase-js";

// Effectif réel d'une équipe — team_memberships (migration-clubplus-v13.sql) × player_profiles.
// Pas de colonne "poste" côté player_profiles (le mock l'inventait) : volontairement absent ici.
// Droit à l'image : parental_authorizations × authorization_types(code='droit_image'), même
// modèle que data/family/authorizations.ts — jamais les 5 booléens fictifs du mock.

export interface TeamRosterPlayer {
  id: string;
  firstName: string;
  lastName: string;
  shirtNumber: string | null;
  licenseNumber: string | null;
  accountStatus: string;
  imageRightStatus: string;
}

interface TeamMembershipRow {
  player_id: string;
  player_profiles: {
    id: string;
    prenom: string;
    nom: string;
    numero_licence: string | null;
    numero_maillot: string | null;
    account_status: string;
  } | null;
}

interface AuthorizationJoinRow {
  player_id: string;
  statut: string;
}

async function fetchImageRightStatuses(supabase: SupabaseClient, playerIds: string[]): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();
  const { data } = await supabase
    .from("parental_authorizations")
    .select("player_id, statut, authorization_types!inner(code)")
    .in("player_id", playerIds)
    .eq("authorization_types.code", "droit_image");

  const map = new Map<string, string>();
  for (const row of (data ?? []) as unknown as AuthorizationJoinRow[]) {
    map.set(row.player_id, row.statut);
  }
  return map;
}

export async function fetchTeamRoster(supabase: SupabaseClient, teamId: string): Promise<TeamRosterPlayer[]> {
  const { data, error } = await supabase
    .from("team_memberships")
    .select("player_id, player_profiles(id, prenom, nom, numero_licence, numero_maillot, account_status)")
    .eq("team_id", teamId)
    .eq("statut", "active");
  if (error) throw error;

  const rows = ((data ?? []) as unknown as TeamMembershipRow[]).filter((row) => row.player_profiles);
  const imageRightByPlayer = await fetchImageRightStatuses(
    supabase,
    rows.map((row) => row.player_profiles!.id),
  );

  return rows
    .map((row) => {
      const p = row.player_profiles!;
      return {
        id: p.id,
        firstName: p.prenom,
        lastName: p.nom,
        shirtNumber: p.numero_maillot,
        licenseNumber: p.numero_licence,
        accountStatus: p.account_status,
        imageRightStatus: imageRightByPlayer.get(p.id) ?? "non_transmise",
      };
    })
    .sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`, "fr"));
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  sans_compte: "Sans compte",
  invite: "Invité",
  en_attente_activation: "En attente d'activation",
  actif: "Compte actif",
  suspendu: "Suspendu",
  retire: "Retiré",
};
