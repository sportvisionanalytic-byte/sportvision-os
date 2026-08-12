import type { SupabaseClient } from "@supabase/supabase-js";

// Contexte joueur — construit à partir des tables réelles (player_profiles, organizations,
// membership_requests), jamais de données inventées. Un utilisateur sans ligne player_profiles
// n'a simplement pas encore de club (voir edge function connect-player-onboarding, action
// "skip"/pas de player_profiles créée) — état "aucun club", pas une erreur.
//
// Une seule affiliation à la fois : `player_profiles.club_id` est un champ unique (pas une
// table de relation many-to-many). Le vrai modèle "plusieurs affiliations" du nouveau design
// (master doc Partie VI, table conceptuelle `player_affiliations`) n'existe pas encore côté
// backend — construire cette table maintenant dupliquerait la source de vérité utilisée par
// app-next/Club+ (qui lit exclusivement player_profiles/membership_requests) sans les
// synchroniser, exactement ce que le master doc interdit ("un seul objet métier"). Cette page
// gère donc la SEULE affiliation réelle possible aujourd'hui — l'extension multi-club est un
// chantier de schéma à part entière, à trancher explicitement avec Fouka avant de coder.
//
// "Quitter" une affiliation : `player_profiles.club_id` est NOT NULL, donc impossible de le
// vider. On réutilise `account_status = 'retire'` (déjà dans la contrainte CHECK réelle,
// confirmé en direct) — vérifié que app-next traite déjà tout account_status ≠ 'actif' comme
// non-actif (lib/supabase/session.ts:304 : `account_status === "actif" ? "active" : "disabled"`),
// donc un joueur qui quitte disparaît bien des rosters actifs côté club sans code à modifier
// ailleurs.

export interface PlayerContext {
  playerId: string | null;
  firstName: string;
  lastName: string;
  club: {
    id: string;
    nom: string;
    ville: string | null;
    since: string;
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
    .select("id, prenom, nom, club_id, account_status, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return null;

  let club: PlayerContext["club"] = null;
  if (profile.club_id && profile.account_status !== "retire") {
    const { data: org } = await supabase
      .from("organizations")
      .select("id, nom, ville")
      .eq("id", profile.club_id)
      .maybeSingle();

    if (org) {
      const { data: request } = await supabase
        .from("membership_requests")
        .select("statut, created_at")
        .eq("player_id", profile.id)
        .eq("club_id", profile.club_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const statut = request?.statut;
      const status: "affilie" | "attente" | "refuse" =
        statut === "validee" ? "affilie" : statut === "refusee" ? "refuse" : "attente";

      club = {
        id: org.id,
        nom: org.nom,
        ville: org.ville,
        status,
        since: request?.created_at || profile.created_at,
      };
    }
  }

  return { playerId: profile.id, firstName: profile.prenom, lastName: profile.nom, club };
}
