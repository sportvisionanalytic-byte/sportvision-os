import type { SupabaseClient } from "@supabase/supabase-js";

// Pass Photo (Espace joueur) — 02/09/2026 : consomme désormais le moteur média générique
// (migration-media-v1-moteur-generique.sql), qui remplace le Pass Photo figé équipe+saison du
// 28/08/2026 (jamais activé commercialement, aucune vente réelle). Achat toujours PONCTUEL, mais
// le produit acheté (pass saison, vente à l'unité, pack...) est désormais configuré depuis l'OS,
// jamais en dur ici.
//
// Lecture exclusivement via la RPC media_album_list() — jamais un SELECT direct sur `media_albums`
// (aucune policy SELECT authenticated n'existe sur cette table, volontairement : voir le
// commentaire de tête de la migration sur pourquoi secure_collection_ref ne peut pas être protégée
// par RLS seule). `unlocked` et `secureCollectionRef` sont recalculés côté serveur à CHAQUE appel
// via can_access_media(), jamais mis en cache côté client au-delà du rendu courant.
export interface PhotoAlbumTeaser {
  id: string;
  title: string;
  eventDate: string | null;
  coverPreviewUrl: string | null;
  photoCount: number;
  publishedAt: string | null;
  unlocked: boolean;
  secureCollectionRef: string | null;
}

interface AlbumListRpcRow {
  id: string;
  title: string;
  event_date: string | null;
  cover_preview_url: string | null;
  photo_count: number;
  published_at: string | null;
  unlocked: boolean;
  secure_collection_ref: string | null;
}

export async function fetchPhotoAlbums(
  supabase: SupabaseClient,
  clubId: string,
  teamId: string,
  saisonId: string,
): Promise<PhotoAlbumTeaser[]> {
  const { data, error } = await supabase.rpc("media_album_list", {
    p_club_id: clubId,
    p_team_id: teamId,
    p_saison_id: saisonId,
  });
  if (error || !data) return [];
  return (data as AlbumListRpcRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    eventDate: r.event_date,
    coverPreviewUrl: r.cover_preview_url,
    photoCount: r.photo_count ?? 0,
    publishedAt: r.published_at,
    unlocked: r.unlocked === true,
    secureCollectionRef: r.secure_collection_ref,
  }));
}

export interface AvailableMediaProduct {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  currency: string;
}

/** Produits actifs que ce joueur peut acheter pour son équipe (portée club ou équipe) — alimente
 * le bouton d'achat de PhotosView sans jamais lui faire deviner un product_id. */
export async function fetchAvailableMediaProducts(
  supabase: SupabaseClient,
  clubId: string,
  teamId: string,
): Promise<AvailableMediaProduct[]> {
  const { data, error } = await supabase
    .from("media_products")
    .select("id, name, type, price_cents, currency, scope_type, team_ids")
    .eq("club_id", clubId)
    .eq("status", "active");
  if (error || !data) return [];
  return data
    .filter((p) => p.scope_type === "club" || (p.scope_type === "team" && Array.isArray(p.team_ids) && p.team_ids.includes(teamId)))
    .map((p) => ({ id: p.id, name: p.name, type: p.type, priceCents: p.price_cents, currency: p.currency }));
}
