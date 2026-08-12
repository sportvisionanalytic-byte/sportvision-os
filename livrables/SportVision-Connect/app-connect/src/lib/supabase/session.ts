import type { SupabaseClient } from "@supabase/supabase-js";

// Contexte joueur — construit à partir des tables réelles (player_profiles, organizations,
// membership_requests), jamais de données inventées. Un utilisateur sans ligne player_profiles
// n'a simplement pas encore de club (voir edge function connect-player-onboarding, action
// "skip"/pas de player_profiles créée) — état "aucun club", pas une erreur.

export interface PlayerContext {
  firstName: string;
  lastName: string;
  club: {
    id: string;
    nom: string;
    ville: string | null;
    // "affilie" = demande validée · "attente" = demande pas encore traitée · "refuse" = refusée
    status: "affilie" | "attente" | "refuse";
  } | null;
}

export async function buildPlayerContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlayerContext | null> {
  const { data: profile } = await supabase
    .from("player_profiles")
    .select("id, prenom, nom, club_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return null;

  let club: PlayerContext["club"] = null;
  if (profile.club_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("id, nom, ville")
      .eq("id", profile.club_id)
      .maybeSingle();

    if (org) {
      const { data: request } = await supabase
        .from("membership_requests")
        .select("statut")
        .eq("player_id", profile.id)
        .eq("club_id", profile.club_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const statut = request?.statut;
      const status: "affilie" | "attente" | "refuse" =
        statut === "validee" ? "affilie" : statut === "refusee" ? "refuse" : "attente";

      club = { id: org.id, nom: org.nom, ville: org.ville, status };
    }
  }

  return { firstName: profile.prenom, lastName: profile.nom, club };
}
