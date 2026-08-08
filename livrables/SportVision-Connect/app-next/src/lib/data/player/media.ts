import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchClubMediaAssets } from "@/lib/data/club/content";

/**
 * Mêmes tables que côté club (club_media/club_creations, filtrées par club_id) — voir le plan
 * Phase 2 § Décisions d'architecture n°4. Ce n'est pas un filtre applicatif qui restreint aux
 * médias visibles pour cette famille : c'est la policy RLS fail-closed `is_media_visible_to_family`
 * (media_access_rules + media_player_tags, migration-clubplus-v18/v30), appliquée automatiquement
 * quel que soit l'appelant authentifié. `clubId` = player_profiles.club_id (exposé côté frontend
 * via ctx.organization.parentOrganizationId pour un espace joueur).
 */
export async function fetchPlayerMediaAssets(supabase: SupabaseClient, clubId: string) {
  return fetchClubMediaAssets(supabase, clubId);
}
