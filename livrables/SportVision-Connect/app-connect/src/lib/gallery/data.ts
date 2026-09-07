import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartLine, GalleryProduct, LinkOffer, PriceLadderEntry } from "./pricing";

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
  /** TOUTES les formules vendues par ce lien, dans l'ordre configuré dans l'OS. Tableau vide =
   * galerie de consultation, ou lien historique qui retombe sur le catalogue du club. Le nombre
   * d'offres est libre : la page doit s'afficher correctement avec 1 comme avec 7. */
  offres: LinkOffer[];
  /** Plafond de photos montrées AVANT achat. null = toutes, et c'est le cas par défaut : sur un
   * tournoi, un parent doit pouvoir parcourir les 500 photos pour retrouver son enfant. Le
   * plafond ne sert qu'aux liens qu'on ne veut pas exposer entièrement. */
  apercuLimite: number | null;
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
      offres: parseOffers(row.offres),
      apercuLimite: row.apercu_limite === null || row.apercu_limite === undefined ? null : Number(row.apercu_limite),
    },
  };
}

/** `offres` est un tableau jsonb côté base. On ne fabrique jamais d'offre par défaut, et on
 * n'invente jamais de prix : ce qui n'est pas configuré n'est pas vendu. */
function parseOffers(raw: unknown): LinkOffer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((o) => ({
      offerId: (o.offer_id as string) ?? null,
      productId: (o.product_id as string) ?? null,
      type: (o.type as string) ?? null,
      name: (o.name as string) ?? "Accès aux photos",
      priceCents: Number(o.price_cents ?? 0),
      currency: (o.currency as string) ?? "eur",
      photosAllowance:
        o.photos_allowance === null || o.photos_allowance === undefined ? null : Number(o.photos_allowance),
      featured: o.featured === true,
    }));
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
  /** L'offre choisie parmi celles du lien. Le serveur revérifie qu'elle appartient bien à ce
   * lien-là : envoyer l'identifiant d'une offre moins chère trouvée ailleurs ne sert à rien. */
  offerId?: string | null;
  /** Les photos choisies, pour une offre à quota. Vide pour un album complet. */
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
  /** Pack : nombre de photos que l'acheteur a le droit de choisir. null pour une galerie complète
   * ou un achat à la photo, où il n'y a rien à choisir. */
  photosAllowance: number | null;
  selectionFaite: boolean;
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
    photosAllowance:
      row.photos_allowance === null || row.photos_allowance === undefined ? null : Number(row.photos_allowance),
    selectionFaite: row.selection_faite === true,
    photos: ((row.photos as Record<string, unknown>[] | null) ?? []).map((p) => ({
      id: p.id as string,
      thumbUrl: publicMediaUrl(p.thumb_path as string),
      previewUrl: publicMediaUrl((p.preview_path as string) ?? (p.thumb_path as string)),
      filename: (p.filename as string) ?? "photo.jpg",
    })),
  };
}

/**
 * Photos parmi lesquelles choisir après avoir acheté un pack.
 *
 * L'acheteur arrive ici avec le seul jeton reçu par e-mail : il n'a plus forcément le lien de la
 * galerie, et celui-ci peut avoir été désactivé entre-temps. Son droit de voir ces photos vient de
 * sa commande payée, pas du lien.
 */
export async function fetchOrderChoices(
  supabase: SupabaseClient,
  token: string,
  options: { limit?: number; offset?: number } = {},
): Promise<GalleryPage> {
  const { data, error } = await supabase.rpc("media_gallery_order_choices", {
    p_token: token,
    p_limit: options.limit ?? 200,
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

export type SelectionRefus = "introuvable" | "non_payee" | "sans_objet" | "deja_choisie" | "aucune_photo" | "trop_de_photos";

/**
 * Enregistre le choix de photos d'un pack. DÉFINITIF.
 *
 * Le quota et l'appartenance des photos à l'album sont revérifiés en base : une liste envoyée
 * depuis le navigateur ne prouve rien, et quelqu'un qui paierait 5 photos ne doit pas pouvoir en
 * réclamer 20. Le caractère définitif n'est pas une contrainte technique mais commerciale — pouvoir
 * rechanger ses 5 photos indéfiniment reviendrait à obtenir la galerie entière au prix d'un pack.
 */
export async function submitOrderSelection(
  supabase: SupabaseClient,
  token: string,
  assetIds: string[],
): Promise<{ ok: true; selectionnees: number } | { ok: false; raison: SelectionRefus }> {
  const { data, error } = await supabase.rpc("media_gallery_order_select", {
    p_token: token,
    p_asset_ids: assetIds,
  });
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (error || !row) return { ok: false, raison: "introuvable" };
  if (row.ok === true) return { ok: true, selectionnees: Number(row.selectionnees ?? assetIds.length) };
  return { ok: false, raison: ((row.raison as SelectionRefus) ?? "introuvable") };
}

// ── L'espace Connect de l'acheteur ────────────────────────────────────────────────────────────
// Tout passe par des RPC : media_albums n'est lisible que par le staff, et un compte Connect ne
// doit pas se voir ouvrir une table entière pour afficher un titre de match. Aucune de ces
// fonctions ne renvoie de chemin d'original — le téléchargement reste signé au clic par
// gallery-download, exactement comme pour un invité. Un droit permanent n'est PAS une URL
// permanente : c'est le droit d'en redemander une.

export interface MyGallery {
  albumId: string;
  titre: string;
  clubNom: string | null;
  equipe: string | null;
  eventDate: string | null;
  coverUrl: string | null;
  /** Photos réellement possédées, union de toutes ses commandes sans doublon. Ce n'est PAS le
   * quota vendu : un pack de 17 dont l'acheteur n'a retenu que 13 photos en affiche 13. */
  photosAcquises: number;
  albumPhotos: number;
  accesComplet: boolean;
  accesPermanent: boolean;
  expiresAt: string | null;
  commandes: number;
}

export async function fetchMyGalleries(supabase: SupabaseClient): Promise<MyGallery[]> {
  const { data, error } = await supabase.rpc("media_my_galleries");
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    albumId: r.album_id as string,
    titre: (r.titre as string) ?? "Galerie",
    clubNom: (r.club_nom as string) ?? null,
    equipe: (r.equipe as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    photosAcquises: Number(r.photos_acquises ?? 0),
    albumPhotos: Number(r.album_photos ?? 0),
    accesComplet: r.acces_complet === true,
    accesPermanent: r.acces_permanent === true,
    expiresAt: (r.expires_at as string) ?? null,
    commandes: Number(r.commandes ?? 0),
  }));
}

export async function fetchMyGalleryPhotos(
  supabase: SupabaseClient,
  albumId: string,
): Promise<OrderPhoto[]> {
  const { data, error } = await supabase.rpc("media_my_gallery_photos", { p_album_id: albumId });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    thumbUrl: publicMediaUrl(r.thumb_path as string),
    previewUrl: publicMediaUrl((r.preview_path as string) ?? (r.thumb_path as string)),
    filename: (r.filename as string) ?? "photo.jpg",
  }));
}

export interface MyOrder {
  orderId: string;
  albumId: string | null;
  albumTitre: string | null;
  clubNom: string | null;
  equipe: string | null;
  eventDate: string | null;
  coverUrl: string | null;
  offreNom: string | null;
  offreType: string | null;
  totalCents: number;
  currency: string;
  paidAt: string | null;
  photosCount: number;
  accesPermanent: boolean;
  expiresAt: string | null;
  token: string;
}

export async function fetchMyOrders(supabase: SupabaseClient): Promise<MyOrder[]> {
  const { data, error } = await supabase.rpc("media_my_gallery_orders");
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    orderId: r.order_id as string,
    albumId: (r.album_id as string) ?? null,
    albumTitre: (r.album_titre as string) ?? null,
    clubNom: (r.club_nom as string) ?? null,
    equipe: (r.equipe as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    offreNom: (r.offre_nom as string) ?? null,
    offreType: (r.offre_type as string) ?? null,
    totalCents: Number(r.total_cents ?? 0),
    currency: (r.currency as string) ?? "eur",
    paidAt: (r.paid_at as string) ?? null,
    photosCount: Number(r.photos_count ?? 0),
    accesPermanent: r.acces_permanent === true,
    expiresAt: (r.expires_at as string) ?? null,
    token: r.token as string,
  }));
}
