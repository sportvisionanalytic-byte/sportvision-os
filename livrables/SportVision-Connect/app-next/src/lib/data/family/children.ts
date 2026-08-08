import type { SupabaseClient } from "@supabase/supabase-js";

// parent_player_relationships (migration-clubplus-v13.sql) — « toute donnée relative à un enfant
// passe TOUJOURS par parent_player_relationships filtré sur parent_id + statut='confirme' avant
// d'aller chercher quoi que ce soit d'autre » (règle explicite de famille-espace.js, reproduite
// ici). RLS : ppr_parent_select (le parent lui-même).

export interface ConfirmedChild {
  relationshipId: string;
  playerId: string;
  firstName: string;
  lastName: string;
  dateNaissance: string;
  numeroLicence: string | null;
  numeroMaillot: string | null;
  accountStatus: string;
  teamName?: string;
  clubName?: string;
}

interface RelationshipRow {
  id: string;
  player_profiles: {
    id: string;
    prenom: string;
    nom: string;
    date_naissance: string;
    numero_licence: string | null;
    numero_maillot: string | null;
    account_status: string;
  } | null;
}

interface TeamMembershipRow {
  player_id: string;
  club_teams: { name: string } | null;
  clubs: { nom: string } | null;
}

const SELECT =
  "id, player_profiles(id, prenom, nom, date_naissance, numero_licence, numero_maillot, account_status)";

export async function fetchConfirmedChildren(supabase: SupabaseClient, parentId: string): Promise<ConfirmedChild[]> {
  const { data } = await supabase
    .from("parent_player_relationships")
    .select(SELECT)
    .eq("parent_id", parentId)
    .eq("statut", "confirme");

  const children = ((data ?? []) as unknown as RelationshipRow[])
    .filter((row) => row.player_profiles)
    .map((row) => ({
      relationshipId: row.id,
      playerId: row.player_profiles!.id,
      firstName: row.player_profiles!.prenom,
      lastName: row.player_profiles!.nom,
      dateNaissance: row.player_profiles!.date_naissance,
      numeroLicence: row.player_profiles!.numero_licence,
      numeroMaillot: row.player_profiles!.numero_maillot,
      accountStatus: row.player_profiles!.account_status,
    }));

  if (children.length === 0) return children;

  const { data: membershipData } = await supabase
    .from("team_memberships")
    .select("player_id, club_teams(name), clubs(nom)")
    .in(
      "player_id",
      children.map((c) => c.playerId),
    )
    .eq("statut", "active");

  const teamByPlayer = new Map<string, { teamName?: string; clubName?: string }>();
  for (const row of (membershipData ?? []) as unknown as TeamMembershipRow[]) {
    if (!teamByPlayer.has(row.player_id)) {
      teamByPlayer.set(row.player_id, { teamName: row.club_teams?.name, clubName: row.clubs?.nom });
    }
  }

  return children.map((c) => ({ ...c, ...teamByPlayer.get(c.playerId) }));
}
