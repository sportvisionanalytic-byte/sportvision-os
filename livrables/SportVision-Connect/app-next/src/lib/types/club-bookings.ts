import type { BadgeTone } from "@/components/ui/Badge";

// Entités du flux "Prestations SportVision" côté club — catalogue_offres (migration-portail-
// v1.sql) + club_bookings (migration-clubplus-v6.sql). Port fidèle de la référence vanille
// fonctionnelle (livrables/SportVision-Connect/app/modules/club-services-documents-rapports.js,
// window.ClubModules.services) vers les conventions React/TS de ce repo — voir
// src/lib/data/club/bookings.ts pour la lecture/écriture réelle et
// src/components/services/ClubServicesBoard.tsx pour l'UI. Fichier séparé de src/lib/types/
// services.ts (module générique Espace Projet, table `prestations`, non compatible — voir
// entitlements.ts § "services" pour le détail du mismatch qui a motivé ce module séparé).

export type ClubBookingStatus =
  | "recue"
  | "qualifiee"
  | "confirmee"
  | "operateur_affecte"
  | "mission_realisee"
  | "livree"
  | "annulee";

/** Pipeline terrain fixe (6 statuts réels, migration-clubplus-v6.sql `check` constraint) —
 * piloté par le staff SportVision (RLS cbk_admin_update / cbk_staff_update), jamais par le club
 * lui-même une fois la demande envoyée. "annulee" (migration-clubplus-v37) est volontairement
 * EXCLU de ce pipeline linéaire : c'est un état terminal parallèle, pas une étape — voir
 * ClubBookingDetail.tsx où `BOOKING_STEPS.indexOf("annulee")` renvoie -1 (aucune étape allumée),
 * comportement voulu. */
export const BOOKING_STEPS: ClubBookingStatus[] = [
  "recue",
  "qualifiee",
  "confirmee",
  "operateur_affecte",
  "mission_realisee",
  "livree",
];

export const BOOKING_STATUS_LABEL: Record<ClubBookingStatus, string> = {
  recue: "Reçue",
  qualifiee: "Besoin qualifié",
  confirmee: "Confirmée",
  operateur_affecte: "Opérateur affecté",
  mission_realisee: "Mission réalisée",
  livree: "Livrée",
  annulee: "Annulée",
};

export const BOOKING_STATUS_TONE: Record<ClubBookingStatus, BadgeTone> = {
  recue: "info",
  qualifiee: "accent",
  confirmee: "accent",
  operateur_affecte: "warning",
  mission_realisee: "cyan",
  livree: "success",
  annulee: "danger",
};

export type OfferTarifType = "fixe" | "sur_devis";

export interface ClubCatalogueOffre {
  id: string;
  nom: string;
  description: string | null;
  tarifType: OfferTarifType;
  /** Toujours `null` quand `tarifType === "sur_devis"` — jamais un 0 € affiché comme un fait. */
  prixHt: number | null;
  dureeEstimee: string | null;
}

export interface ClubBooking {
  id: string;
  clubId: string;
  serviceId: string | null;
  serviceLabel: string;
  team: string | null;
  eventDate: string | null;
  heure: string | null;
  adresse: string | null;
  status: ClubBookingStatus;
  /** Snapshot texte libre du tarif au moment de la réservation (ex. "150,00 € HT (-5% Club+)"
   * ou "Sur devis") — jamais recalculé après coup, voir data/club/bookings.ts § fullPriceLabel. */
  priceLabel: string | null;
  createdAt: string;
}

export type ClubPlan = "free" | "club" | "performance";
