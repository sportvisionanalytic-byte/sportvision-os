import type { SupabaseClient } from "@supabase/supabase-js";

// Pass Photo (Espace joueur) — voir migration-connect-pass-photo-v1.sql. Achat PONCTUEL (pas un
// abonnement) qui déverrouille tous les albums PUBLIÉS d'une équipe + une saison donnée.
//
// Lecture exclusivement via la RPC photo_album_list() — jamais un SELECT direct sur `photo_albums`
// (aucune policy SELECT authenticated n'existe sur cette table, volontairement : voir le
// commentaire de tête de la migration sur pourquoi secure_collection_ref ne peut pas être protégée
// par RLS seule). `unlocked` et `secureCollectionRef` sont recalculés côté serveur à CHAQUE appel,
// jamais mis en cache côté client au-delà du rendu courant.
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
  seasonId: string,
): Promise<PhotoAlbumTeaser[]> {
  const { data, error } = await supabase.rpc("photo_album_list", {
    p_club_id: clubId,
    p_team_id: teamId,
    p_season_id: seasonId,
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
