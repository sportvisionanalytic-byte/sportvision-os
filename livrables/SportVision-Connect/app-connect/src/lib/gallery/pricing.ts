// Tarification d'une sélection de photos — module pur, sans React ni Supabase.
//
// Règle produit (§16 du prompt) : « ne laisse pas volontairement le client payer 20 € quand un
// pack à 15 € couvre son besoin ». On calcule donc la combinaison la MOINS CHÈRE parmi les
// produits que l'OS a réellement configurés pour cet album, et on montre l'économie.
//
// Aucun prix n'est écrit ici, jamais. Tout vient de `media_products` : ce fichier ne connaît que
// des règles de combinaison, pas des montants.
//
// Le calcul est un problème de couverture classique, résolu par programmation dynamique :
//   coût(n) = min( coût(n-1) + prix unitaire , pour chaque pack k : coût(max(0, n-k)) + prix pack )
// Un pack peut « déborder » volontairement : acheter un pack de 5 pour 3 photos est autorisé s'il
// revient moins cher que 3 photos à l'unité, et c'est exactement ce qu'un client attend.
// L'album complet, s'il existe, plafonne le tout.

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

/** Produits réellement utilisables pour vendre des photos d'une galerie à l'unité ou par lot.
 * Les autres types (pass saison, produit physique...) relèvent d'un autre parcours et ne sont pas
 * appliqués silencieusement à une sélection. */
export function sellableProducts(products: GalleryProduct[]): {
  unit: GalleryProduct | null;
  packs: GalleryProduct[];
  wholeAlbum: GalleryProduct | null;
} {
  const unit = products
    .filter((p) => p.type === "photo_unite")
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
  const packs = products
    .filter((p) => p.type === "pack" && (p.packPhotos ?? 0) > 0)
    .sort((a, b) => (a.packPhotos ?? 0) - (b.packPhotos ?? 0));
  const wholeAlbum = products
    .filter((p) => p.type === "album_complet")
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
  return { unit, packs, wholeAlbum };
}

/** true si cette galerie peut vendre quelque chose à la photo. Une galerie sans tarif unitaire ni
 * pack est une galerie de consultation (ou de livraison gratuite) : l'écran ne doit alors afficher
 * aucune mécanique de panier. */
export function isSellable(products: GalleryProduct[]): boolean {
  const { unit, packs, wholeAlbum } = sellableProducts(products);
  return Boolean(unit || packs.length > 0 || wholeAlbum);
}

/**
 * Meilleur prix pour `count` photos sélectionnées.
 *
 * `totalPhotos` sert uniquement à savoir si l'album complet couvre la sélection : proposer
 * « toute la galerie » pour 3 photos sur 200 n'a de sens que si c'est réellement moins cher.
 */
export function quoteSelection(
  count: number,
  products: GalleryProduct[],
  totalPhotos: number,
): CartQuote | null {
  const currency = products[0]?.currency ?? "eur";
  const { unit, packs, wholeAlbum } = sellableProducts(products);
  if (count <= 0) return null;
  if (!unit && packs.length === 0 && !wholeAlbum) return null;

  // best[n] = { cost, choix } où `choix` est le dernier produit ajouté pour atteindre n.
  const INF = Number.POSITIVE_INFINITY;
  const best: { cost: number; from: number; product: GalleryProduct | null }[] = [
    { cost: 0, from: 0, product: null },
  ];

  for (let n = 1; n <= count; n++) {
    let bestCost = INF;
    let bestFrom = 0;
    let bestProduct: GalleryProduct | null = null;

    if (unit) {
      const candidate = best[n - 1]!.cost + unit.priceCents;
      if (candidate < bestCost) {
        bestCost = candidate;
        bestFrom = n - 1;
        bestProduct = unit;
      }
    }
    for (const pack of packs) {
      const from = Math.max(0, n - (pack.packPhotos ?? 0));
      const candidate = best[from]!.cost + pack.priceCents;
      // `<` strict : à prix égal on garde la solution déjà trouvée, qui utilise le plus petit
      // produit. Un client préfère « 1 photo » à « pack de 10 » pour le même montant.
      if (candidate < bestCost) {
        bestCost = candidate;
        bestFrom = from;
        bestProduct = pack;
      }
    }
    best.push({ cost: bestCost, from: bestFrom, product: bestProduct });
  }

  const combination = best[count]!;
  const baselineCents = unit ? unit.priceCents * count : null;

  // L'album complet plafonne : s'il couvre toutes les photos pour moins cher que la combinaison,
  // c'est lui la bonne réponse — y compris quand le client n'a sélectionné qu'une partie.
  if (wholeAlbum && (combination.cost === INF || wholeAlbum.priceCents < combination.cost)) {
    return {
      lines: [
        {
          productId: wholeAlbum.id,
          name: wholeAlbum.name,
          type: wholeAlbum.type,
          quantity: 1,
          unitPriceCents: wholeAlbum.priceCents,
          coversPhotos: totalPhotos,
        },
      ],
      totalCents: wholeAlbum.priceCents,
      baselineCents,
      savingsCents: baselineCents ? Math.max(0, baselineCents - wholeAlbum.priceCents) : 0,
      wholeAlbum: true,
      currency: wholeAlbum.currency,
    };
  }

  if (combination.cost === INF) return null;

  // Remontée du chemin optimal pour reconstituer les lignes du panier.
  const tally = new Map<string, CartLine>();
  let n = count;
  while (n > 0) {
    const step = best[n]!;
    const product = step.product;
    if (!product) break;
    const existing = tally.get(product.id);
    const covers = n - step.from;
    if (existing) {
      existing.quantity += 1;
      existing.coversPhotos += covers;
    } else {
      tally.set(product.id, {
        productId: product.id,
        name: product.name,
        type: product.type,
        quantity: 1,
        unitPriceCents: product.priceCents,
        coversPhotos: covers,
      });
    }
    n = step.from;
  }

  const lines = Array.from(tally.values()).sort((a, b) => b.unitPriceCents - a.unitPriceCents);
  return {
    lines,
    totalCents: combination.cost,
    baselineCents,
    savingsCents: baselineCents ? Math.max(0, baselineCents - combination.cost) : 0,
    wholeAlbum: false,
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
