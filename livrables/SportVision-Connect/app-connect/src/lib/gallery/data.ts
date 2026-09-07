import type { SupabaseClient } from "@supabase/supabase-js";
import type { GalleryProduct } from "./pricing";

// Lecture de la galerie publique. Tout passe par les quatre RPC de
// migration-galeries-v3-publique.sql, jamais par un SELECT direct : media_albums et media_assets
// n'ont volontairement aucune policy de lecture pour `anon`, et une policy ne saurait de toute
// façon ni vérifier un jeton de lien, ni un mot de passe, ni journaliser une vue.
//
// Le jeton n'est jamais déduit ni deviné côté client : il vient du lien reçu par le visiteur.

export interface GalleryHeader {
  albumId: string;
  titre: string;
  eventDate: string | null;
  clubNom: string | null;
  equipe: string | null;
  coverUrl: string | null;
  photoCount: number;
  /** Ancien mode de livraison : album sans photo en base, livré par lien privé. On sait qu'il
   * existe, on ne le montre jamais (§25). */
  livraisonExterne: boolean;
  watermark: boolean;
}

export type GalleryDenial =
  | "introuvable"
  | "desactive"
  | "expire"
  | "non_publie"
  | "mot_de_passe"
  | "mot_de_passe_invalide";

export type GalleryOpenResult =
  | { ok: true; header: GalleryHeader }
  | { ok: false; raison: GalleryDenial };

export interface GalleryPhoto {
  id: string;
  thumbUrl: string;
  previewUrl: string;
  width: number | null;
  height: number | null;
}

const PREVIEW_BUCKET = "galerie-previews";

/** Les dérivés vivent dans un bucket public : leur URL se construit sans signature, ce qui permet
 * au CDN de les servir et à une galerie de 500 vignettes de s'afficher vite. L'original, lui,
 * n'est jamais renvoyé par les RPC — le client ne peut donc pas en fabriquer le chemin. */
export function publicMediaUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${PREVIEW_BUCKET}/${path}`;
}

export async function openGallery(
  supabase: SupabaseClient,
  slug: string,
  token: string,
  password?: string | null,
): Promise<GalleryOpenResult> {
  const { data, error } = await supabase.rpc("media_gallery_open", {
    p_slug: slug,
    p_token: token,
    p_password: password ?? null,
  });
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  // Une erreur réseau ne doit pas se présenter comme un lien invalide : le visiteur croirait que
  // sa galerie a été supprimée. On retombe sur "introuvable" seulement quand la base a réellement
  // répondu que le lien ne vaut rien.
  if (error || !row) return { ok: false, raison: "introuvable" };
  if (row.valide !== true) return { ok: false, raison: (row.raison as GalleryDenial) ?? "introuvable" };

  return {
    ok: true,
    header: {
      albumId: row.album_id as string,
      titre: (row.titre as string) ?? "Galerie",
      eventDate: (row.event_date as string) ?? null,
      clubNom: (row.club_nom as string) ?? null,
      equipe: (row.equipe as string) ?? null,
      coverUrl: (row.cover_url as string) ?? null,
      photoCount: (row.photo_count as number) ?? 0,
      livraisonExterne: row.livraison_externe === true,
      watermark: row.watermark !== false,
    },
  };
}

export interface GalleryPage {
  photos: GalleryPhoto[];
  total: number;
}

export async function fetchGalleryPhotos(
  supabase: SupabaseClient,
  slug: string,
  token: string,
  options: { password?: string | null; limit?: number; offset?: number } = {},
): Promise<GalleryPage> {
  const { data, error } = await supabase.rpc("media_gallery_photos", {
    p_slug: slug,
    p_token: token,
    p_password: options.password ?? null,
    p_limit: options.limit ?? 60,
    p_offset: options.offset ?? 0,
  });
  if (error || !Array.isArray(data)) return { photos: [], total: 0 };
  const rows = data as Record<string, unknown>[];
  return {
    total: rows.length > 0 ? Number(rows[0]!.total ?? rows.length) : 0,
    photos: rows.map((r) => ({
      id: r.id as string,
      thumbUrl: publicMediaUrl(r.thumb_path as string),
      previewUrl: publicMediaUrl((r.preview_path as string) ?? (r.thumb_path as string)),
      width: (r.width as number) ?? null,
      height: (r.height as number) ?? null,
    })),
  };
}

export async function fetchGalleryProducts(
  supabase: SupabaseClient,
  slug: string,
  token: string,
  password?: string | null,
): Promise<GalleryProduct[]> {
  const { data, error } = await supabase.rpc("media_gallery_products", {
    p_slug: slug,
    p_token: token,
    p_password: password ?? null,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as string,
    priceCents: Number(r.price_cents ?? 0),
    currency: (r.currency as string) ?? "eur",
    packPhotos: r.pack_photos === null || r.pack_photos === undefined ? null : Number(r.pack_photos),
    physicalProduct: r.physical_product === true,
  }));
}

/** Comptage de vue. L'identifiant est un jeton de SESSION aléatoire gardé le temps de l'onglet :
 * ce n'est pas une empreinte de navigateur, rien n'est déduit de l'appareil, et la base le hache
 * avec l'identifiant de l'album avant de le stocker. */
export async function trackGalleryView(
  supabase: SupabaseClient,
  slug: string,
  token: string,
  sessionId: string,
): Promise<void> {
  await supabase.rpc("media_gallery_track_view", { p_slug: slug, p_token: token, p_session: sessionId });
}
