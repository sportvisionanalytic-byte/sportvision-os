import type { SupabaseClient } from "@supabase/supabase-js";

// Pass Photo (Espace joueur) — 02/09/2026 : consomme désormais le moteur média générique
// (migration-media-v1-moteur-generique.sql), qui remplace le Pass Photo figé équipe+saison du
// 28/08/2026 (jamais activé commercialement, aucune vente réelle). Achat toujours PONCTUEL, mais
// le produit acheté (pass saison, vente à l'unité, pack...) est désormais configuré depuis l'OS,
// jamais en dur ici.
//
// Lecture exclusivement via la RPC media_album_list() — jamais un SELECT direct sur `media_albums`
// (aucune policy SELECT authenticated n'existe sur cette table, volontairement).
// P2 audit 04-05/09 (finding H47), priorité remontée avant vente à grande échelle : le lien HD
// réel (secure_collection_ref) n'est PLUS jamais renvoyé par ce listing — il fuitait dans chaque
// chargement de page dès qu'un album était déverrouillé, sans re-vérification ni trace au moment
// de l'accès réel. Il ne s'obtient désormais que via fetchAlbumLink(), appelée au clic explicite
// sur "Ouvrir la collection", qui revérifie l'entitlement à cet instant précis côté serveur et
// journalise l'accès (media_link_access_log) — voir migration-media-hd-acces-controle.sql.
export interface PhotoAlbumTeaser {
  id: string;
  title: string;
  eventDate: string | null;
  coverPreviewUrl: string | null;
  photoCount: number;
  publishedAt: string | null;
  unlocked: boolean;
}

interface AlbumListRpcRow {
  id: string;
  title: string;
  event_date: string | null;
  cover_preview_url: string | null;
  photo_count: number;
  published_at: string | null;
  unlocked: boolean;
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
  }));
}

/** Révèle le lien HD réel d'un album déjà déverrouillé — jamais pré-chargé, appelée seulement au
 * clic. Renvoie null si l'entitlement a été révoqué entre-temps (revérifié à chaque appel) ou en
 * cas d'erreur réseau ; l'appelant doit afficher un message plutôt que de supposer un lien mort. */
export async function fetchAlbumLink(supabase: SupabaseClient, albumId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("media_album_get_link", { p_album_id: albumId });
  if (error) return null;
  return (data as string | null) ?? null;
}

export interface AvailableMediaProduct {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  currency: string;
  /** Fulfillment produit physique (04/09/2026, migration-media-physical-fulfillment.sql) — impose
   * de collecter une adresse de livraison avant l'achat, voir create-pass-photo-checkout. */
  physicalProduct: boolean;
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
    .select("id, name, type, price_cents, currency, scope_type, team_ids, physical_product")
    .eq("club_id", clubId)
    .eq("status", "active");
  if (error || !data) return [];
  return data
    .filter((p) => p.scope_type === "club" || (p.scope_type === "team" && Array.isArray(p.team_ids) && p.team_ids.includes(teamId)))
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      priceCents: p.price_cents,
      currency: p.currency,
      physicalProduct: p.physical_product === true,
    }));
}
