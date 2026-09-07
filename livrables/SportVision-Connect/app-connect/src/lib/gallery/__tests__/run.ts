// Tests de la mise en forme du prix côté galerie.
//
//   node --test src/lib/gallery/__tests__/run.ts
//
// Le CALCUL du prix n'est plus ici : il vit en base (`_media_gallery_best_price`,
// migration-galeries-v4-checkout.sql) et y est testé sur 17 scénarios, parce que c'est le même
// code qui affiche et qui facture. Ce fichier ne teste donc que ce qui reste côté navigateur :
// lire la grille pré-calculée, décider si une galerie a quelque chose à vendre, et formater.

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPrice,
  isSellable,
  quoteFromLadder,
  sellableProducts,
  type GalleryProduct,
  type PriceLadderEntry,
} from "../pricing.ts";

const P = (over: Partial<GalleryProduct>): GalleryProduct => ({
  id: over.id ?? "p",
  name: over.name ?? "Produit",
  type: over.type ?? "photo_unite",
  priceCents: over.priceCents ?? 400,
  currency: "eur",
  packPhotos: over.packPhotos ?? null,
  physicalProduct: false,
});

const UNITE = P({ id: "u", name: "Photo a l'unite", type: "photo_unite", priceCents: 400 });
const PACK5 = P({ id: "p5", name: "Pack 5 photos", type: "pack", priceCents: 1500, packPhotos: 5 });
const ALBUM = P({ id: "a", name: "Galerie complete", type: "album_complet", priceCents: 2900 });

// Grille telle que la base la renvoie pour ce catalogue.
const GRILLE: PriceLadderEntry[] = [
  { photos: 1, totalCents: 400, wholeAlbum: false, baselineCents: 400,
    lines: [{ productId: "u", name: "Photo a l'unite", type: "photo_unite", quantity: 1, unitPriceCents: 400, coversPhotos: 1 }] },
  { photos: 4, totalCents: 1500, wholeAlbum: false, baselineCents: 1600,
    lines: [{ productId: "p5", name: "Pack 5 photos", type: "pack", quantity: 1, unitPriceCents: 1500, coversPhotos: 4 }] },
  { photos: 12, totalCents: 2900, wholeAlbum: true, baselineCents: 4800,
    lines: [{ productId: "a", name: "Galerie complete", type: "album_complet", quantity: 1, unitPriceCents: 2900, coversPhotos: 20 }] },
];

test("aucune selection : pas de devis", () => {
  assert.equal(quoteFromLadder(0, GRILLE), null);
});

test("lecture de la grille : le total vient de la base, pas d'un calcul local", () => {
  const q = quoteFromLadder(4, GRILLE)!;
  assert.equal(q.totalCents, 1500);
  assert.equal(q.baselineCents, 1600);
  assert.equal(q.savingsCents, 100, "l'economie se deduit, elle ne se recalcule pas");
  assert.equal(q.lines[0]!.name, "Pack 5 photos");
});

test("album complet : la ligne couvre toutes les photos", () => {
  const q = quoteFromLadder(12, GRILLE)!;
  assert.equal(q.wholeAlbum, true);
  assert.equal(q.lines[0]!.coversPhotos, 20);
  assert.equal(q.savingsCents, 1900);
});

test("aucune economie annoncee sans reference unitaire", () => {
  const grille: PriceLadderEntry[] = [{ photos: 3, totalCents: 2900, wholeAlbum: true, baselineCents: null, lines: [] }];
  assert.equal(quoteFromLadder(3, grille)!.savingsCents, 0);
});

test("nombre absent de la grille : aucun prix affiche plutot qu'un prix approche", () => {
  // Celui qui s'affiche doit etre celui qui sera debite : mieux vaut ne rien montrer.
  assert.equal(quoteFromLadder(7, GRILLE), null);
});

test("galerie vendable ou non", () => {
  assert.equal(isSellable([]), false);
  assert.equal(isSellable([P({ id: "ps", type: "pass_saison", priceCents: 4900 })]), false, "un pass saison est un autre parcours");
  assert.equal(isSellable([UNITE]), true);
  assert.equal(isSellable([ALBUM]), true);
});

test("un pack sans taille n'est pas retenu comme vendable", () => {
  const packCasse = P({ id: "px", type: "pack", priceCents: 100, packPhotos: null });
  assert.equal(sellableProducts([packCasse]).packs.length, 0);
  assert.equal(isSellable([packCasse]), false);
});

test("le moins cher de chaque famille est retenu", () => {
  const cher = P({ id: "u2", type: "photo_unite", priceCents: 900 });
  assert.equal(sellableProducts([cher, UNITE]).unit?.id, "u");
  assert.equal(sellableProducts([UNITE, PACK5, ALBUM]).wholeAlbum?.id, "a");
});

test("formatage des prix en euros", () => {
  // Intl utilise une espace fine insecable (U+202F) avant le symbole : on normalise toutes les
  // formes d'espace avant de comparer, sinon le test casse au gre des versions d'ICU.
  const norm = (s: string) => s.replace(/[\s\u00a0\u202f]/g, " ");
  assert.equal(norm(formatPrice(400)), "4 €");
  assert.equal(norm(formatPrice(1550)), "15,50 €");
});
