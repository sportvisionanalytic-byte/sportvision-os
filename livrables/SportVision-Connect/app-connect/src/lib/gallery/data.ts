import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartLine, GalleryProduct, PriceLadderEntry } from "./pricing";

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

/**
 * Grille tarifaire pré-calculée par la base : « pour 1 photo, 2 photos, 3 photos… voilà le prix ».
 *
 * Chargée une fois à l'ouverture de la galerie. C'est ce qui permet d'afficher un total
 * instantanément à chaque photo cochée sans aller-retour réseau, tout en gardant UN SEUL moteur de
 * prix — celui de la base, qui est aussi celui qui facture.
 */
export async function fetchPriceLadder(
  supabase: SupabaseClient,
  slug: string,
  token: string,
  password?: string | null,
): Promise<PriceLadderEntry[]> {
  const { data, error } = await supabase.rpc("media_gallery_price_ladder", {
    p_slug: slug,
    p_token: token,
    p_password: password ?? null,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    photos: Number(r.photos ?? 0),
    totalCents: Number(r.total_cents ?? 0),
    wholeAlbum: r.whole_album === true,
    baselineCents: r.baseline_cents === null || r.baseline_cents === undefined ? null : Number(r.baseline_cents),
    lines: ((r.lines as Record<string, unknown>[] | null) ?? []).map((l) => ({
      productId: String(l.product_id),
      name: String(l.name),
      type: String(l.type),
      quantity: Number(l.quantity ?? 1),
      unitPriceCents: Number(l.unit_price_cents ?? 0),
      coversPhotos: Number(l.covers_photos ?? 0),
    })) as CartLine[],
  }));
}

export interface CheckoutRequest {
  slug: string;
  token: string;
  password?: string | null;
  assetIds: string[];
  email: string;
  nom: string;
}

/**
 * Démarre le paiement.
 *
 * Le MONTANT N'EST PAS TRANSMIS : la fonction serveur le recalcule depuis les mêmes règles que la
 * grille affichée. Un client qui poste sa propre requête ne peut donc pas choisir son prix, et
 * l'écran ne peut pas afficher un total différent de celui qui sera débité.
 *
 * Passe par une Edge Function Supabase, comme tous les autres paiements du projet
 * (create-guest-media-checkout, create-pass-photo-checkout…) : la clé Stripe y vit déjà, et le
 * webhook qui encaisse est au même endroit. Un deuxième chemin de paiement côté Netlify aurait
 * imposé d'y dupliquer la clé secrète.
 */
export async function startGalleryCheckout(
  supabase: SupabaseClient,
  req: CheckoutRequest,
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.functions.invoke("create-gallery-checkout", { body: req });
  const payload = data as { url?: string; error?: string } | null;
  if (error || !payload?.url) {
    return { error: payload?.error ?? "Le paiement n'a pas pu démarrer. Réessayez dans un instant." };
  }
  return { url: payload.url };
}

export interface OrderPhoto {
  id: string;
  thumbUrl: string;
  previewUrl: string;
  filename: string;
}

export interface OrderSummary {
  orderId: string;
  albumTitre: string | null;
  clubNom: string | null;
  email: string;
  totalCents: number;
  currency: string;
  expiresAt: string;
  expiree: boolean;
  dejaRattachee: boolean;
  photos: OrderPhoto[];
}

/** Récapitulatif d'une commande payée, lisible avec le seul jeton reçu par e-mail. La fonction
 * en base revérifie le paiement et l'expiration à chaque appel, et ne renvoie jamais de chemin
 * d'original : c'est la route de téléchargement qui signe une URL, une par une, au clic. */
export async function fetchOrderSummary(supabase: SupabaseClient, token: string): Promise<OrderSummary | null> {
  const { data, error } = await supabase.rpc("media_gallery_order_summary", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (error || !row) return null;
  return {
    orderId: row.order_id as string,
    albumTitre: (row.album_titre as string) ?? null,
    clubNom: (row.club_nom as string) ?? null,
    email: (row.email as string) ?? "",
    totalCents: Number(row.total_cents ?? 0),
    currency: (row.currency as string) ?? "eur",
    expiresAt: row.expires_at as string,
    expiree: row.expiree === true,
    dejaRattachee: row.deja_rattachee === true,
    photos: ((row.photos as Record<string, unknown>[] | null) ?? []).map((p) => ({
      id: p.id as string,
      thumbUrl: publicMediaUrl(p.thumb_path as string),
      previewUrl: publicMediaUrl((p.preview_path as string) ?? (p.thumb_path as string)),
      filename: (p.filename as string) ?? "photo.jpg",
    })),
  };
}
