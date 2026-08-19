import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BookingModePaiement,
  ClubBooking,
  ClubBookingStatus,
  ClubCatalogueOffre,
  ClubPlan,
  OfferCategorie,
  OfferTarifType,
} from "@/lib/types/club-bookings";

// Port de window.ClubModules.services (livrables/SportVision-Connect/app/modules/
// club-services-documents-rapports.js, lignes 189-436, référence vanille fonctionnelle) —
// catalogue_offres (migration-portail-v1.sql, lecture publique des lignes actif=true) et
// club_bookings (migration-clubplus-v6.sql, RLS is_club_member pour select/insert, is_club_admin
// pour update/delete — voir migration-connect-v34-club-bookings-staff-access.sql pour l'ajout du
// bypass staff nécessaire côté OS, ce module ne l'utilise pas).
//
// Divergence volontaire : `created_by` utilise le vrai `auth.uid()` de la session Supabase
// ((await supabase.auth.getUser()).data.user?.id), pas `localStorage.getItem('svc_uid')` comme la
// référence vanille (pattern propre à l'ancienne app, sans équivalent ici).

interface CatalogueRow {
  id: string;
  nom: string;
  description: string | null;
  categorie: OfferCategorie;
  tarif_type: OfferTarifType;
  prix_ht: number | null;
  tva_pct: number | null;
  duree_estimee: string | null;
}

interface BookingRow {
  id: string;
  club_id: string;
  service_id: string | null;
  service_label: string;
  team: string | null;
  event_date: string | null;
  heure: string | null;
  adresse: string | null;
  status: ClubBookingStatus;
  price_label: string | null;
  mode_paiement: BookingModePaiement | null;
  created_at: string;
}

function toOffer(row: CatalogueRow): ClubCatalogueOffre {
  return {
    id: row.id,
    nom: row.nom,
    description: row.description,
    categorie: row.categorie,
    tarifType: row.tarif_type,
    prixHt: row.tarif_type === "sur_devis" ? null : row.prix_ht,
    tvaPct: row.tva_pct ?? 20,
    dureeEstimee: row.duree_estimee,
  };
}

function toBooking(row: BookingRow): ClubBooking {
  return {
    id: row.id,
    clubId: row.club_id,
    serviceId: row.service_id,
    serviceLabel: row.service_label,
    team: row.team,
    eventDate: row.event_date,
    heure: row.heure,
    adresse: row.adresse,
    status: row.status,
    priceLabel: row.price_label,
    modePaiement: row.mode_paiement,
    createdAt: row.created_at,
  };
}

export async function fetchCatalogueOffres(supabase: SupabaseClient): Promise<ClubCatalogueOffre[]> {
  const { data, error } = await supabase
    .from("catalogue_offres")
    .select("id, nom, description, categorie, tarif_type, prix_ht, tva_pct, duree_estimee")
    .eq("actif", true)
    .order("ordre", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as CatalogueRow[]).map(toOffer);
}

export async function fetchClubBookings(supabase: SupabaseClient, clubId: string): Promise<ClubBooking[]> {
  const { data, error } = await supabase
    .from("club_bookings")
    .select("id, club_id, service_id, service_label, team, event_date, heure, adresse, status, price_label, mode_paiement, created_at")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as BookingRow[]).map(toBooking);
}

/** `clubs.plan` — défaut 'club' si non renseigné, même règle que la référence vanille. */
export async function fetchClubPlan(supabase: SupabaseClient, clubId: string): Promise<ClubPlan> {
  const { data } = await supabase.from("clubs").select("plan").eq("id", clubId).maybeSingle();
  const plan = (data as { plan: string } | null)?.plan;
  if (plan === "performance") return "performance";
  if (plan === "free") return "free";
  return "club";
}

// ── Tarification indicative (portée à l'identique de la référence vanille) ──

/** Club+ Gratuit n'ouvre droit à aucune remise (confirmé par Fouka, 19/08/2026). */
export function reductionPct(plan: ClubPlan): number {
  if (plan === "performance") return 10;
  if (plan === "free") return 0;
  return 5;
}

export function planLabel(plan: ClubPlan): string {
  if (plan === "performance") return "Club+ Performance";
  if (plan === "free") return "Club+ Gratuit";
  return "Club+";
}

/** "Couverture tournoi" = traitement prioritaire réservé à Club+ Performance, identifié par son
 * NOM faute de colonne dédiée côté catalogue_offres (dette technique documentée dans la
 * référence vanille, portée telle quelle — ne pas redesigner ici). */
export function isOfferLocked(offer: Pick<ClubCatalogueOffre, "nom">, plan: ClubPlan): boolean {
  return offer.nom === "Couverture tournoi" && plan !== "performance";
}

function money(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Affiche un prix TTC (cohérent avec la vitrine publique, qui n'affiche jamais de HT à un
 * client) — 19/08/2026, audit pré-lancement : cet écran affichait du HT nu, seul endroit de
 * l'app dans ce cas. `tvaPct` vient de catalogue_offres.tva_pct (défaut 20 si absent). */
export function offerPriceLabel(offer: Pick<ClubCatalogueOffre, "tarifType" | "prixHt" | "tvaPct">): string {
  if (offer.tarifType === "sur_devis" || offer.prixHt == null) return "Sur devis";
  const ttc = offer.prixHt * (1 + offer.tvaPct / 100);
  return `${money(ttc)} € TTC`;
}

/** Vide (jamais "-0% Club+ Gratuit") quand le plan n'ouvre droit à aucune remise — voir
 * reductionPct : "free" vaut 0, un "-0%" affiché comme avantage induirait en erreur. */
export function offerAdvantageLabel(offer: Pick<ClubCatalogueOffre, "tarifType">, plan: ClubPlan): string {
  if (offer.tarifType === "sur_devis") return "";
  const pct = reductionPct(plan);
  if (pct <= 0) return "";
  return `-${pct}% ${planLabel(plan)}`;
}

/** Prix TTC déjà remisé — retour utilisateur 19/08/2026 : le badge "-10% ..." seul à côté du
 * prix plein demandait un calcul mental, le prix réellement payé doit être affiché directement.
 * `null` quand aucune remise ne s'applique (sur devis, ou plan sans remise) — le catalogue
 * retombe alors sur offerPriceLabel seul, jamais un prix barré à côté de lui-même. */
export function offerDiscountedPriceLabel(
  offer: Pick<ClubCatalogueOffre, "tarifType" | "prixHt" | "tvaPct">,
  plan: ClubPlan,
): string | null {
  if (offer.tarifType === "sur_devis" || offer.prixHt == null) return null;
  const pct = reductionPct(plan);
  if (pct <= 0) return null;
  const ttc = offer.prixHt * (1 + offer.tvaPct / 100);
  return `${money(ttc * (1 - pct / 100))} € TTC`;
}

/** Snapshot figé au moment de la réservation dans `price_label` — indicatif uniquement, la
 * facturation réelle reste un devis/facture séparé géré par le staff. */
export function fullPriceLabel(offer: Pick<ClubCatalogueOffre, "tarifType" | "prixHt" | "tvaPct"> | null, plan: ClubPlan): string {
  if (!offer) return "Sur devis";
  const advantage = offerAdvantageLabel(offer, plan);
  return offerPriceLabel(offer) + (advantage ? ` (${advantage})` : "");
}

export interface SubmitBookingInput {
  clubId: string;
  offer: ClubCatalogueOffre | null;
  team: string;
  eventDate: string;
  heure: string;
  adresse: string;
  plan: ClubPlan;
  modePaiement: BookingModePaiement | null;
}

export async function submitClubBooking(supabase: SupabaseClient, input: SubmitBookingInput): Promise<ClubBooking> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("club_bookings")
    .insert({
      club_id: input.clubId,
      service_id: input.offer?.id ?? null,
      service_label: input.offer?.nom ?? "Prestation",
      team: input.team || null,
      event_date: input.eventDate || null,
      heure: input.heure || null,
      adresse: input.adresse || null,
      status: "recue",
      price_label: fullPriceLabel(input.offer, input.plan),
      mode_paiement: input.modePaiement,
      created_by: userData.user?.id ?? null,
    })
    .select("id, club_id, service_id, service_label, team, event_date, heure, adresse, status, price_label, mode_paiement, created_at")
    .single();
  if (error || !data) throw error ?? new Error("Envoi de la demande impossible.");
  return toBooking(data as BookingRow);
}
