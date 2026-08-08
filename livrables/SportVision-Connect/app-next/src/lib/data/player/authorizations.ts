import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChildAuthorizations, type ChildAuthorization } from "@/lib/data/family/authorizations";

/**
 * Même table que côté famille (parental_authorizations), lecture seule pour le joueur — la RLS
 * pa_player_select l'autorise, mais les RPC de signature/retrait sont réservées au parent
 * confirmé (ou au staff), voir le plan Phase 2 § Points non vérifiés #3 : même un joueur majeur
 * sans parent confirmé ne peut pas se signer lui-même une autorisation avec les RPC telles
 * qu'elles existent aujourd'hui. Pas de bouton d'action côté joueur pour cette raison.
 */
export async function fetchPlayerAuthorizations(supabase: SupabaseClient, playerId: string): Promise<ChildAuthorization[]> {
  return fetchChildAuthorizations(supabase, playerId);
}
