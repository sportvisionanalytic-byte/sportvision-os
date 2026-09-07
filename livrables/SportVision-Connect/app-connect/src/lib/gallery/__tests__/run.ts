// Tests du moteur tarifaire de la galerie publique.
//
//   node --test src/lib/gallery/__tests__/run.ts
//
// Module pur, sans React ni Supabase : il se teste tel quel, sans navigateur ni base.

import assert from "node:assert/strict";
import test from "node:test";

import { isSellable, quoteSelection, sellableProducts, formatPrice, type GalleryProduct } from "../pricing.ts";

const P = (over: Partial<GalleryProduct>): GalleryProduct => ({
  id: over.id ?? "p",
  name: over.name ?? "Produit",
  type: over.type ?? "photo_unite",
  priceCents: over.priceCents ?? 400,
  currency: "eur",
  packPhotos: over.packPhotos ?? null,
  physicalProduct: false,
});

// Tarifs volontairement identiques a ceux configures dans l'OS pour l'album de test reel.
const UNITE = P({ id: "u", name: "Photo a l'unite", type: "photo_unite", priceCents: 400 });
const PACK5 = P({ id: "p5", name: "Pack 5 photos", type: "pack", priceCents: 1500, packPhotos: 5 });
const PACK10 = P({ id: "p10", name: "Pack 10 photos", type: "pack", priceCents: 2500, packPhotos: 10 });
const ALBUM = P({ id: "a", name: "Galerie complete", type: "album_complet", priceCents: 2900 });
const CATALOGUE = [UNITE, PACK5, PACK10, ALBUM];

test("aucune selection : pas de devis", () => {
  assert.equal(quoteSelection(0, CATALOGUE, 20), null);
});

test("1 a 3 photos : le tarif unitaire reste le moins cher", () => {
  for (const n of [1, 2, 3]) {
    const q = quoteSelection(n, CATALOGUE, 20)!;
    assert.equal(q.totalCents, n * 400, `${n} photos`);
    assert.equal(q.savingsCents, 0);
    assert.deepEqual(q.lines.map((l) => l.productId), ["u"]);
    assert.equal(q.lines[0]!.quantity, n);
  }
});

test("4 photos : le pack de 5 devient plus avantageux, et on l'applique", () => {
  // 4 x 4 EUR = 16 EUR, or le pack 5 est a 15 EUR. Laisser payer 16 EUR serait exactement ce que
  // le paragraphe 16 interdit.
  const q = quoteSelection(4, CATALOGUE, 20)!;
  assert.equal(q.totalCents, 1500);
  assert.equal(q.baselineCents, 1600);
  assert.equal(q.savingsCents, 100);
  assert.deepEqual(q.lines.map((l) => l.productId), ["p5"]);
});

test("5 photos : pack 5 applique, 5 EUR economises", () => {
  const q = quoteSelection(5, CATALOGUE, 20)!;
  assert.equal(q.totalCents, 1500);
  assert.equal(q.savingsCents, 500);
});

test("7 photos : pack 5 + 2 unites, meilleur que 2 packs de 5", () => {
  // 15 + 8 = 23 EUR, contre 30 EUR pour deux packs et 28 EUR a l'unite.
  const q = quoteSelection(7, CATALOGUE, 20)!;
  assert.equal(q.totalCents, 2300);
  const ids = q.lines.map((l) => l.productId).sort();
  assert.deepEqual(ids, ["p5", "u"]);
  assert.equal(q.lines.find((l) => l.productId === "u")!.quantity, 2);
});

test("9 photos : le pack de 10 couvre plus que demande et coute moins cher", () => {
  // 25 EUR pour le pack 10, contre 15 + 16 = 31 EUR (pack 5 + 4 unites) et 36 EUR a l'unite.
  const q = quoteSelection(9, CATALOGUE, 20)!;
  assert.equal(q.totalCents, 2500);
  assert.deepEqual(q.lines.map((l) => l.productId), ["p10"]);
});

test("12 photos : la galerie complete devient la meilleure offre", () => {
  // 29 EUR pour tout, contre 25 + 8 = 33 EUR. Le client paie moins et repart avec 20 photos.
  const q = quoteSelection(12, CATALOGUE, 20)!;
  assert.equal(q.wholeAlbum, true);
  assert.equal(q.totalCents, 2900);
  assert.equal(q.lines[0]!.coversPhotos, 20);
});

test("sans album complet, la combinaison de packs reste optimale", () => {
  const q = quoteSelection(12, [UNITE, PACK5, PACK10], 20)!;
  // 25 (pack 10) + 8 (2 unites) = 33 EUR, meilleur que 2 packs de 5 + 2 unites (38) et que 48 a l'unite.
  assert.equal(q.totalCents, 3300);
  assert.equal(q.wholeAlbum, false);
});

test("galerie vendue uniquement en album complet", () => {
  const q = quoteSelection(3, [ALBUM], 20)!;
  assert.equal(q.wholeAlbum, true);
  assert.equal(q.totalCents, 2900);
  assert.equal(q.baselineCents, null, "aucun tarif unitaire : pas de reference de comparaison");
  assert.equal(q.savingsCents, 0, "on n'annonce jamais une economie qu'on ne peut pas prouver");
});

test("galerie gratuite : aucun mecanisme de panier", () => {
  assert.equal(isSellable([]), false);
  assert.equal(quoteSelection(3, [], 20), null);
  // Un pass saison seul ne rend pas une galerie vendable a la photo : c'est un autre parcours.
  const pass = P({ id: "ps", name: "Pass Saison", type: "pass_saison", priceCents: 4900 });
  assert.equal(isSellable([pass]), false);
  assert.equal(quoteSelection(3, [pass], 20), null);
});

test("un pack sans taille configuree n'est jamais applique", () => {
  const packCasse = P({ id: "px", name: "Pack mystere", type: "pack", priceCents: 100, packPhotos: null });
  const q = quoteSelection(5, [UNITE, packCasse], 20)!;
  assert.equal(q.totalCents, 2000, "5 x 4 EUR : le pack sans taille est ignore, pas applique au hasard");
  assert.equal(sellableProducts([UNITE, packCasse]).packs.length, 0);
});

test("a prix egal, on garde le produit le plus petit", () => {
  const packEgal = P({ id: "pe", name: "Pack 3", type: "pack", priceCents: 1200, packPhotos: 3 });
  const q = quoteSelection(3, [UNITE, packEgal], 20)!;
  assert.equal(q.totalCents, 1200);
  assert.deepEqual(q.lines.map((l) => l.productId), ["u"], "3 photos plutot qu'un pack, pour le meme prix");
});

test("selection tres large : le calcul reste correct et rapide", () => {
  const debut = Date.now();
  const q = quoteSelection(500, [UNITE, PACK5, PACK10], 500)!;
  // 50 packs de 10 = 250 EUR, contre 2000 EUR a l'unite.
  assert.equal(q.totalCents, 125000);
  assert.ok(Date.now() - debut < 200, "calcul sous 200 ms");
});

test("formatage des prix en euros", () => {
  assert.equal(formatPrice(400).replace(/ | /g, " "), "4 €");
  assert.equal(formatPrice(1550).replace(/ | /g, " "), "15,50 €");
});
