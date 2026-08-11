import type { SupabaseClient } from "@supabase/supabase-js";

// Identité du club d'un joueur — utilisé par la Sidebar (carte "Mon club", remplace la carte
// offre/crédits qui n'a aucun sens pour un espace personnel, voir brief Fouka § 18), le Dashboard
// Joueur (carte "Mon club", § 4) et Paramètres (bloc lecture seule, § 16). Un seul point de
// lecture pour éviter trois requêtes légèrement différentes.
//
// `teamName`/`categorie` : player_profiles n'a pas de colonne équipe propre (voir migration-
// clubplus-v13.sql) — dérivés honnêtement de la dernière demande d'adhésion VALIDÉE
// (membership_requests.statut = 'validee', voir data/player/team-requests.ts, même table). Un
// joueur qui n'a encore rejoint aucune équipe (compte tout juste créé) a donc `teamName: null` —
// jamais une équipe inventée.
export interface PlayerClubInfo {
  clubName: string;
  teamName: string | null;
  categorie: string | null;
}

interface JoinRequestRow {
  club_teams: { name: string; categorie: string | null } | null;
}

export async function fetchPlayerClubInfo(
  supabase: SupabaseClient,
  clubId: string,
  playerId: string,
): Promise<PlayerClubInfo> {
  const [orgRes, teamRes] = await Promise.all([
    supabase.from("organizations").select("nom").eq("id", clubId).maybeSingle(),
    supabase
      .from("membership_requests")
      .select("club_teams(name, categorie)")
      .eq("player_id", playerId)
      .eq("statut", "validee")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const clubName = (orgRes.data as { nom: string } | null)?.nom ?? "Votre club";
  const row = ((teamRes.data ?? []) as unknown as JoinRequestRow[])[0];

  return {
    clubName,
    teamName: row?.club_teams?.name ?? null,
    categorie: row?.club_teams?.categorie ?? null,
  };
}
