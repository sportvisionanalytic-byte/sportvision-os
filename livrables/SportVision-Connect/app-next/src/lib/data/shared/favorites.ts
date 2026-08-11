import type { SupabaseClient } from "@supabase/supabase-js";

// Favoris sur les contenus — contenu_favoris (migration-connect-v43-espace-joueur.sql), voir le
// commentaire de la migration pour pourquoi `media_asset_id` est du texte libre (id composite
// "media-<uuid>"/"creation-<uuid>", pas une FK vers `contenus`). Scope volontairement large
// (n'importe quel utilisateur authentifié), même si seule l'interface Joueur l'expose aujourd'hui
// (brief Fouka § 9) — rien n'empêche de le réutiliser plus tard pour un autre espace.

export async function fetchFavoriteIds(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("contenu_favoris").select("media_asset_id").eq("user_id", userId);
  if (error) return new Set();
  return new Set(((data ?? []) as { media_asset_id: string }[]).map((r) => r.media_asset_id));
}

export async function addFavorite(supabase: SupabaseClient, mediaAssetId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("contenu_favoris")
    .insert({ media_asset_id: mediaAssetId, user_id: userId });
  // 23505 = doublon (unique(media_asset_id, user_id)) — déjà favori, pas une erreur pour l'utilisateur.
  if (error && error.code !== "23505") throw error;
}

export async function removeFavorite(supabase: SupabaseClient, mediaAssetId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("contenu_favoris")
    .delete()
    .eq("media_asset_id", mediaAssetId)
    .eq("user_id", userId);
  if (error) throw error;
}
