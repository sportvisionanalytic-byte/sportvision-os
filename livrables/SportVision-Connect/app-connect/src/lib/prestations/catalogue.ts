import type { SupabaseClient } from "@supabase/supabase-js";

// Catalogue central des prestations — `catalogue_offres` (migration-portail-v1/v2/v13/v17.sql),
// même table que app-next (Espace Projet) et le tunnel club Club+ : SOURCE UNIQUE des tarifs
// (MASTER-CONNECT-V1.md §51, §18 étape1 : "Catalogue centralisé, jamais de tarifs dupliqués
// dans plusieurs composants"). Ce fichier ne fait QUE lire/dériver — aucun prix n'est jamais
// recalculé ou stocké en dur ici.
//
// Décision produit documentée (non tranchée, voir rapport final de l'agent) : le design de
// référence (Connect Espace Joueur.dc.html) présente 6 offres réparties en 3 familles
// (Match / Captation / Montage). En réalité, `catalogue_offres` contient aujourd'hui 7 lignes
// utilisables pour un espace joueur (match-photo, match-video, pack-match, match-camera-veo,
// combo-veo-photo, match-filme-drone, combo-drone-photo) réparties en 2 familles (Match /
// Captation) — AUCUNE offre "Montage Highlight" n'existe dans le catalogue réel, et les tarifs
// Veo réels (110 €/170 € TTC, migration-portail-v13.sql) diffèrent de ceux du mockup (120 €/
// 180 € TTC). Plutôt que d'inventer une offre Highlight avec un tarif non validé en base, ou de
// modifier des tarifs Veo déjà en production, ce module affiche fidèlement le catalogue réel et
// dérive dynamiquement les familles disponibles (l'onglet "Montage" apparaîtra tout seul le jour
// où une offre categorie='montage' existera réellement).

export type CatalogueFamily = "Match" | "Captation";

export interface CatalogueOption {
  nom: string;
  prixHt: number;
}

export interface CatalogueOffer {
  id: string;
  slug: string;
  nom: string;
  description: string | null;
  categorie: string;
  family: CatalogueFamily | null;
  tarifType: "fixe" | "sur_devis";
  prixHt: number | null;
  tvaPct: number;
  dureeEstimee: string | null;
  livrablesInclus: string | null;
  options: CatalogueOption[];
  ordre: number;
}

interface CatalogueOffreRow {
  id: string;
  slug: string;
  nom: string;
  description: string | null;
  categorie: string;
  tarif_type: "fixe" | "sur_devis";
  prix_ht: number | null;
  tva_pct: number | null;
  duree_estimee: string | null;
  livrables_inclus: string | null;
  options: unknown;
  ordre: number | null;
}

// Familles commerciales affichées à un joueur — volontairement plus restreintes que le
// catalogue complet : shooting/couverture-tournoi/couverture-stage/création de contenu sont des
// offres orientées particulier/pro (Espace Projet), hors périmètre de "Prestations" espace
// joueur (voir MASTER-CONNECT-V1.md §17, catalogue "de son organisation/périmètre").
const CATEGORIE_FAMILY: Record<string, CatalogueFamily> = {
  photo: "Match",
  video: "Match",
  veo: "Captation",
  drone: "Captation",
};

function familyOf(row: CatalogueOffreRow): CatalogueFamily | null {
  if (row.categorie === "pack") {
    // `pack-match` (photo+vidéo d'un même match) est une offre Match ; `combo-veo-photo` et
    // `combo-drone-photo` sont des offres Captation packagées avec l'option Photo — même
    // catégorie technique ("pack") pour les deux, distinguées ici par préfixe de slug.
    return row.slug.startsWith("combo-") ? "Captation" : "Match";
  }
  return CATEGORIE_FAMILY[row.categorie] ?? null;
}

function parseOptions(raw: unknown): CatalogueOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is { nom?: unknown; prix_ht?: unknown } => !!o && typeof o === "object")
    .map((o) => ({ nom: String(o.nom ?? ""), prixHt: Number(o.prix_ht ?? 0) }))
    .filter((o) => o.nom);
}

const SELECT = "id, slug, nom, description, categorie, tarif_type, prix_ht, tva_pct, duree_estimee, livrables_inclus, options, ordre";

/** Catalogue complet visible par un joueur — lecture publique (policy `catalogue_public_read`,
 * actif=true), aucune authentification requise, mais toujours appelée depuis une page protégée
 * par le middleware Connect. */
export async function fetchPlayerCatalogue(supabase: SupabaseClient): Promise<CatalogueOffer[]> {
  const { data, error } = await supabase
    .from("catalogue_offres")
    .select(SELECT)
    .eq("actif", true)
    .order("ordre", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as CatalogueOffreRow[])
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      nom: row.nom,
      description: row.description,
      categorie: row.categorie,
      family: familyOf(row),
      tarifType: row.tarif_type,
      prixHt: row.prix_ht,
      tvaPct: row.tva_pct ?? 20,
      dureeEstimee: row.duree_estimee,
      livrablesInclus: row.livrables_inclus,
      options: parseOptions(row.options),
      ordre: row.ordre ?? 0,
    }))
    .filter((o) => o.family !== null);
}

export async function fetchPlayerOfferById(supabase: SupabaseClient, id: string): Promise<CatalogueOffer | null> {
  const { data, error } = await supabase.from("catalogue_offres").select(SELECT).eq("id", id).eq("actif", true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as CatalogueOffreRow;
  const family = familyOf(row);
  if (!family) return null;
  return {
    id: row.id,
    slug: row.slug,
    nom: row.nom,
    description: row.description,
    categorie: row.categorie,
    family,
    tarifType: row.tarif_type,
    prixHt: row.prix_ht,
    tvaPct: row.tva_pct ?? 20,
    dureeEstimee: row.duree_estimee,
    livrablesInclus: row.livrables_inclus,
    options: parseOptions(row.options),
    ordre: row.ordre ?? 0,
  };
}

/** TTC de base (sans option), ou null si tarif sur devis. */
export function baseTtc(offer: Pick<CatalogueOffer, "tarifType" | "prixHt" | "tvaPct">): number | null {
  if (offer.tarifType !== "fixe" || offer.prixHt == null) return null;
  return Math.round(offer.prixHt * (1 + offer.tvaPct / 100) * 100) / 100;
}

/** TTC total avec les options sélectionnées (par nom, doit matcher `option.nom`). */
export function totalTtcWithOptions(offer: Pick<CatalogueOffer, "tarifType" | "prixHt" | "tvaPct" | "options">, selectedOptionNames: string[]): number | null {
  if (offer.tarifType !== "fixe" || offer.prixHt == null) return null;
  const optionsHt = offer.options.filter((o) => selectedOptionNames.includes(o.nom)).reduce((sum, o) => sum + o.prixHt, 0);
  return Math.round((offer.prixHt + optionsHt) * (1 + offer.tvaPct / 100) * 100) / 100;
}

/** Mention "À 10 joueurs : X €/personne" — toutes les offres Match/Captation sont collectives
 * (seule une éventuelle offre individuelle, ex. Montage, ne le serait pas — aucune n'existe
 * aujourd'hui dans le catalogue réel, voir commentaire d'en-tête). */
export function perPersonTtc(ttc: number, headcount = 10): number {
  return Math.round((ttc / headcount) * 100) / 100;
}

/** Badge "Paiement à plusieurs disponible" / "Individuel" (design de référence, Connect Espace
 * Joueur.dc.html, B_COLLECTIF / B_INDIV) — dérivé de `categorie`, pas d'une nouvelle donnée : le
 * wizard de réservation (ReservationWizard.tsx step "Paiement") propose déjà "Payer à plusieurs"
 * sans restriction pour toute offre du catalogue réel actuel (aucune n'est individuelle-only,
 * voir perPersonTtc ci-dessus). Seule une offre "montage" (aucune aujourd'hui, voir commentaire
 * d'en-tête) serait individuelle, comme "Montage Highlight" dans la maquette. */
export function isCollectif(offer: Pick<CatalogueOffer, "categorie">): boolean {
  return offer.categorie !== "montage";
}

/** Badge "Recommandé" (pastille blanche, design de référence) — porté par l'équivalent réel de
 * la "Pack Match Photo + Vidéo" mise en avant dans la maquette : `pack-match` ("Pack Match
 * Complet", migration-portail-seed.sql) est le même produit (photo + vidéo réunies pour une
 * couverture complète du match). Pas une nouvelle donnée : juste l'identification du bon slug. */
export function isRecommended(offer: Pick<CatalogueOffer, "slug">): boolean {
  return offer.slug === "pack-match";
}

export const FAMILY_ICON: Record<CatalogueFamily, string> = {
  Match: "sports_soccer",
  Captation: "videocam",
};

export function categorieIcon(categorie: string): string {
  switch (categorie) {
    case "photo":
      return "photo_camera";
    case "video":
      return "videocam";
    case "pack":
      return "auto_awesome_motion";
    case "veo":
      return "videocam";
    case "drone":
      return "airwave";
    default:
      return "camera_alt";
  }
}
