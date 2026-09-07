// Affichage du prix d'une sélection — AUCUN calcul commercial ici.
//
// Le prix se calcule en base, une seule fois, dans `_media_gallery_best_price`
// (migration-galeries-v4-checkout.sql). Ce module ne fait que lire la grille tarifaire que la base
// a pré-calculée, et la mettre en forme.
//
// C'est un changement délibéré par rapport à la V1 de la galerie : l'algorithme de meilleure
// combinaison vivait ici, en TypeScript. Il affichait bien, mais dès qu'il a fallu ENCAISSER, un
// deuxième calcul en base est devenu obligatoire — un client qui poste sa propre requête au
// checkout choisirait sinon son prix. Deux implémentations d'une même règle commerciale finissent
// toujours par diverger, et c'est précisément ce que le moteur média du 02/09 interdit. Le calcul
// est donc descendu en base, et le navigateur n'en garde rien.
//
// La grille est chargée une fois à l'ouverture de la galerie : l'affichage reste instantané au
// doigt, sans aller-retour réseau à chaque photo cochée.

export type ProductType =
  | "photo_unite"
  | "pack"
  | "album_complet"
  | "pass_saison"
  | "evenementiel"
  | "physique"
  | "autre";

export interface GalleryProduct {
  id: string;
  name: string;
  type: ProductType | string;
  priceCents: number;
  currency: string;
  /** Nombre de photos couvertes par un pack (media_products.metadata.photo_count). */
  packPhotos: number | null;
  physicalProduct: boolean;
}

export interface CartLine {
  productId: string;
  name: string;
  type: string;
  quantity: number;
  unitPriceCents: number;
  /** Nombre de photos couvertes par cette ligne — sert à expliquer le calcul à l'écran. */
  coversPhotos: number;
}

export interface CartQuote {
  lines: CartLine[];
  totalCents: number;
  /** Ce que coûterait la même sélection à l'unité, quand un tarif unitaire existe. */
  baselineCents: number | null;
  savingsCents: number;
  /** true quand la meilleure offre est d'acheter la galerie entière. */
  wholeAlbum: boolean;
  currency: string;
}

/** Une ligne de la grille pré-calculée par la base : « pour N photos, voilà le prix et le détail ». */
export interface PriceLadderEntry {
  photos: number;
  totalCents: number;
  lines: CartLine[];
  wholeAlbum: boolean;
  baselineCents: number | null;
}

/** Produits utilisables pour vendre des photos d'une galerie. Les autres types (pass saison,
 * produit physique...) relèvent d'un autre parcours et ne sont jamais appliqués silencieusement à
 * une sélection. Sert uniquement à décider si l'écran affiche une mécanique de panier. */
export function sellableProducts(products: GalleryProduct[]): {
  unit: GalleryProduct | null;
  packs: GalleryProduct[];
  wholeAlbum: GalleryProduct | null;
} {
  const unit = products.filter((p) => p.type === "photo_unite").sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
  const packs = products
    .filter((p) => p.type === "pack" && (p.packPhotos ?? 0) > 0)
    .sort((a, b) => (a.packPhotos ?? 0) - (b.packPhotos ?? 0));
  const wholeAlbum = products.filter((p) => p.type === "album_complet").sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
  return { unit, packs, wholeAlbum };
}

/** true si cette galerie peut vendre quelque chose à la photo. Une galerie sans tarif unitaire, ni
 * pack, ni album complet est une galerie de consultation : l'écran n'affiche alors aucun panier. */
export function isSellable(products: GalleryProduct[]): boolean {
  const { unit, packs, wholeAlbum } = sellableProducts(products);
  return Boolean(unit || packs.length > 0 || wholeAlbum);
}

/**
 * Prix d'une sélection de `count` photos, lu dans la grille.
 *
 * Renvoie null si la grille ne couvre pas ce nombre — ce qui ne devrait pas arriver, la base la
 * calculant pour toutes les valeurs jusqu'au nombre de photos de l'album. Mieux vaut n'afficher
 * aucun prix qu'un prix approché : celui qui s'affiche doit être celui qui sera débité.
 */
export function quoteFromLadder(count: number, ladder: PriceLadderEntry[], currency = "eur"): CartQuote | null {
  if (count <= 0) return null;
  const entry = ladder.find((e) => e.photos === count);
  if (!entry) return null;
  return {
    lines: entry.lines,
    totalCents: entry.totalCents,
    baselineCents: entry.baselineCents,
    savingsCents: entry.baselineCents ? Math.max(0, entry.baselineCents - entry.totalCents) : 0,
    wholeAlbum: entry.wholeAlbum,
    currency,
  };
}

export function formatPrice(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
