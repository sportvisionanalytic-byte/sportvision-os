import type { SupabaseClient } from "@supabase/supabase-js";

// Transition de saison — construite sur renew_season_membership (migration-clubplus-v22.sql,
// jamais dupliquée ici) : chaque joueur actif de la saison en cours reçoit une décision explicite
// (renouveler/déplacer/archiver/mettre en attente/quitter le club), jamais reconduit
// silencieusement (doctrine v22 §20 du prompt d'origine). club_teams n'a pas de notion de saison
// (permanent, voir migration-clubplus-v5.sql) : seule team_memberships est scopée par saison, donc
// "changer de saison" = archiver les rattachements actifs de la saison en cours + en créer de
// nouveaux pour la suivante, jamais de nouvelle ligne club_teams.

export type SeasonTransitionAction = "renouvele" | "deplace" | "archive" | "mis_en_attente" | "quitte_club";

export interface SeasonTransitionCandidate {
  membershipId: string;
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  teamId: string;
  teamName: string;
}

interface MembershipRow {
  id: string;
  player_id: string;
  team_id: string;
  player_profiles: { prenom: string; nom: string } | null;
  club_teams: { name: string } | null;
}

export async function fetchClubCurrentSaison(supabase: SupabaseClient, clubId: string): Promise<string> {
  const { data } = await supabase.from("clubs").select("saison").eq("id", clubId).maybeSingle();
  return (data as { saison: string } | null)?.saison ?? "";
}

export async function fetchSeasonTransitionCandidates(
  supabase: SupabaseClient,
  clubId: string,
  currentSaison: string,
): Promise<SeasonTransitionCandidate[]> {
  const { data, error } = await supabase
    .from("team_memberships")
    .select("id, player_id, team_id, player_profiles(prenom, nom), club_teams(name)")
    .eq("club_id", clubId)
    .eq("saison", currentSaison)
    .eq("statut", "active");
  if (error) throw error;

  return ((data ?? []) as unknown as MembershipRow[])
    .filter((row) => row.player_profiles && row.club_teams)
    .map((row) => ({
      membershipId: row.id,
      playerId: row.player_id,
      playerFirstName: row.player_profiles!.prenom,
      playerLastName: row.player_profiles!.nom,
      teamId: row.team_id,
      teamName: row.club_teams!.name,
    }))
    .sort((a, b) => `${a.teamName}${a.playerLastName}`.localeCompare(`${b.teamName}${b.playerLastName}`, "fr"));
}

export interface SeasonTransitionDecision {
  membershipId: string;
  action: SeasonTransitionAction;
  newTeamId?: string;
}

export interface SeasonTransitionResult {
  succeeded: number;
  failed: { membershipId: string; message: string }[];
}

/** Séquentiel plutôt que Promise.all : renew_season_membership fait un insert ... on conflict
 * (player_id, team_id, saison) par joueur — un échec isolé (ex. équipe de destination invalide
 * sur une ligne "déplace") ne doit jamais empêcher les autres décisions déjà validées d'aboutir,
 * et le rapport final doit pouvoir dire précisément laquelle a échoué. */
export async function commitSeasonTransition(
  supabase: SupabaseClient,
  clubId: string,
  toSaison: string,
  decisions: SeasonTransitionDecision[],
): Promise<SeasonTransitionResult> {
  const result: SeasonTransitionResult = { succeeded: 0, failed: [] };

  for (const decision of decisions) {
    const needsDestination = decision.action === "renouvele" || decision.action === "deplace";
    const { error } = await supabase.rpc("renew_season_membership", {
      p_membership_id: decision.membershipId,
      p_action: decision.action,
      p_new_team_id: decision.action === "deplace" ? (decision.newTeamId ?? null) : null,
      p_to_saison: needsDestination ? toSaison : null,
    });
    if (error) {
      result.failed.push({ membershipId: decision.membershipId, message: error.message });
    } else {
      result.succeeded++;
    }
  }

  // La saison du club n'avance que si au moins une décision a été traitée avec succès — mieux
  // vaut une transition incomplète mais visible (résumé avec échecs) qu'un club basculé sur une
  // nouvelle saison sans aucun rattachement dessus.
  if (result.succeeded > 0) {
    const { error } = await supabase.from("clubs").update({ saison: toSaison }).eq("id", clubId);
    if (error) throw error;
  }

  return result;
}

/** "2026-2027" -> "2027-2028" ; toute autre forme renvoie une chaîne vide (l'admin saisit
 * lui-même plutôt que de recevoir une suggestion incohérente). */
export function suggestNextSaison(currentSaison: string): string {
  const match = /^(\d{4})-(\d{4})$/.exec(currentSaison);
  if (!match) return "";
  const start = Number(match[1]) + 1;
  const end = Number(match[2]) + 1;
  return `${start}-${end}`;
}
