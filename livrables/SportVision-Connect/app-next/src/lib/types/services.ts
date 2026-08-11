// Entités du module Prestations — voir DATA_MODEL.md § Service et ACTIONS.md § 12.
// Fichier propre à ce module, ne duplique rien de src/lib/types.ts (voir README.md § Conventions).

import type { BadgeTone } from "@/components/ui/Badge";
import type { PlanCode } from "@/lib/types";

/**
 * Types de prestation proposés à l'étape 1 du tunnel.
 *
 * DÉCISION — ni ACTIONS.md ni DATA_MODEL.md n'énumèrent les valeurs annoncées (ACTIONS.md § 12 :
 * « 11 types de prestation » ; DATA_MODEL.md : « serviceType | enum | 12 valeurs », les deux
 * chiffres étant eux-mêmes en désaccord). En l'absence de liste fournie, ce fichier fixe une
 * liste réaliste de 11 types cohérente avec l'activité SportVision (captation vidéo,
 * photographie, création de contenus pour clubs, joueurs et familles). À faire valider par
 * Fouka si la liste officielle est un jour communiquée.
 */
export type ServiceType =
  | "match_complet"
  | "entrainement"
  | "portraits_joueurs"
  | "interview"
  | "evenement_club"
  | "tournoi_stage"
  | "shooting_equipe"
  | "captation_drone"
  | "evenement_entreprise"
  | "contenu_reseaux"
  | "sur_mesure";

/**
 * Une prestation réelle du catalogue SportVision (`catalogue_offres`, migration-portail-v1.sql) —
 * c'est la même table que le tunnel club (ClubServicesBoard) lit déjà, avec de vrais prix HT
 * validés par Fouka. Le tunnel Espace Projet (étape 1 du tunnel) lit désormais CE catalogue au
 * lieu de la grille SERVICE_TYPE_BASE_PRICE fixée arbitrairement (retirée le 11/08/2026, jamais
 * validée et jusqu'à 4x supérieure aux vrais prix du catalogue pour des prestations comparables —
 * décision explicite de Fouka : un seul catalogue de prix dans toute l'entreprise, pas deux
 * grilles parallèles à maintenir).
 */
export interface CatalogueOffer {
  id: string;
  nom: string;
  description: string | null;
  categorie: string;
  tarifType: "fixe" | "sur_devis";
  prixHt: number | null;
  dureeEstimee: string | null;
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  match_complet: "Match complet",
  entrainement: "Reportage entraînement",
  portraits_joueurs: "Portraits joueurs",
  interview: "Interview",
  evenement_club: "Événement de club",
  tournoi_stage: "Tournoi ou stage",
  shooting_equipe: "Shooting équipe",
  captation_drone: "Captation drone",
  evenement_entreprise: "Événement d'entreprise",
  contenu_reseaux: "Contenu réseaux sociaux",
  sur_mesure: "Prestation sur mesure",
};

export const SERVICE_TYPE_DESCRIPTIONS: Record<ServiceType, string> = {
  match_complet: "Captation intégrale d'une rencontre, montage et temps forts.",
  entrainement: "Suivi d'une séance pour vos contenus réguliers.",
  portraits_joueurs: "Portraits individuels pour l'effectif ou une sélection.",
  interview: "Prise de parole d'un joueur, d'un coach ou d'un dirigeant.",
  evenement_club: "Assemblée générale, soirée, inauguration, vie du club.",
  tournoi_stage: "Couverture d'un tournoi ou d'un stage sur plusieurs jours.",
  shooting_equipe: "Photo officielle d'équipe ou de section.",
  captation_drone: "Prises de vue aériennes du site ou de l'événement.",
  evenement_entreprise: "Opération partenaire ou événement d'entreprise.",
  contenu_reseaux: "Série de contenus courts pensés pour les réseaux.",
  sur_mesure: "Un besoin spécifique non couvert par les autres formats.",
};

export type ServiceOptionCode =
  | "drone"
  | "reel"
  | "highlight"
  | "express_delivery"
  | "extra_photographer"
  | "interview"
  | "live_stories";

export interface ServiceOptionDefinition {
  code: ServiceOptionCode;
  label: string;
  description: string;
  price: number;
}

// Catalogue des 7 options complémentaires — prix fixes, voir DATA_MODEL.md § Service.
export const SERVICE_OPTIONS: ServiceOptionDefinition[] = [
  { code: "drone", label: "Drone", description: "Prises de vue aériennes en complément du tournage au sol.", price: 250 },
  { code: "reel", label: "Reel", description: "Format court vertical monté pour les réseaux sociaux.", price: 180 },
  { code: "highlight", label: "Highlight", description: "Montage des temps forts en une vidéo courte.", price: 220 },
  { code: "express_delivery", label: "Livraison express 48 h", description: "Livrable prioritaire sous 48 heures.", price: 150 },
  { code: "extra_photographer", label: "Photographe supplémentaire", description: "Un second point de vue photo sur l'événement.", price: 320 },
  { code: "interview", label: "Interview", description: "Interview filmée d'un joueur, coach ou dirigeant.", price: 140 },
  { code: "live_stories", label: "Stories en direct", description: "Publication de stories pendant l'événement.", price: 110 },
];

export const SERVICE_OPTION_BY_CODE: Record<ServiceOptionCode, ServiceOptionDefinition> = Object.fromEntries(
  SERVICE_OPTIONS.map((o) => [o.code, o]),
) as Record<ServiceOptionCode, ServiceOptionDefinition>;

/**
 * Remise liée à l'offre — voir ACTIONS.md § 12 étape 4 (« remise liée à l'offre »).
 *
 * DÉCISION — pourcentage non communiqué par le client. Fixé de façon croissante avec le tier
 * de l'offre, à confirmer par Fouka en même temps que les tarifs mensuels des offres
 * (voir README.md § Logique d'abonnement, déjà marqués « à confirmer »).
 */
export const PLAN_SERVICE_DISCOUNT_PCT: Record<PlanCode, number> = {
  essentiel: 0,
  club_plus_start: 10,
  club_plus_performance: 15,
  full_communication: 20,
  club_access: 0,
  one_off: 0,
};

export const SERVICE_DEPOSIT_RATE = 0.3;

/** Estimation de déplacement — DATA_MODEL.md : « l'adresse alimente l'estimation de déplacement »,
 * sans donner de barème. DÉCISION — forfait plat de 45 € dès que l'adresse saisie ne semble pas
 * correspondre au lieu habituel de l'organisation (comparaison naïve de ville, mock uniquement). */
export function estimateTravelFees(address: string, organizationAddress?: string): number {
  if (!address.trim()) return 0;
  if (!organizationAddress) return 45;
  const city = organizationAddress.split(",").pop()?.trim().toLowerCase() ?? "";
  const normalizedCity = city.replace(/^\d{5}\s*/, "");
  return normalizedCity && address.toLowerCase().includes(normalizedCity) ? 0 : 45;
}

/**
 * `basePrice` vient désormais du vrai catalogue (`CatalogueOffer.prixHt`, `catalogue_offres`) —
 * `null` quand l'offre choisie est `tarif_type = 'sur_devis'` (pas de prix fixe, ex. shooting,
 * tournoi, stage, création de contenu). Dans ce cas `computeServicePricing` ne peut pas produire
 * une estimation honnête : `totalPrice`/`depositAmount` valent `null`, à afficher "Sur devis",
 * jamais un chiffre inventé.
 */
export interface ServicePricingInput {
  basePrice: number | null;
  optionCodes: ServiceOptionCode[];
  planCode: PlanCode;
  address: string;
  organizationAddress?: string;
}

export interface ServicePricing {
  basePrice: number | null;
  optionsTotal: number;
  discountPct: number;
  discountAmount: number;
  travelFees: number;
  totalPrice: number | null;
  depositAmount: number | null;
}

export function computeServicePricing(input: ServicePricingInput): ServicePricing {
  const optionsTotal = input.optionCodes.reduce((sum, code) => sum + SERVICE_OPTION_BY_CODE[code].price, 0);
  const discountPct = PLAN_SERVICE_DISCOUNT_PCT[input.planCode];
  const travelFees = estimateTravelFees(input.address, input.organizationAddress);
  if (input.basePrice === null) {
    return { basePrice: null, optionsTotal, discountPct, discountAmount: 0, travelFees, totalPrice: null, depositAmount: null };
  }
  const discountAmount = Math.round(((input.basePrice + optionsTotal) * discountPct) / 100);
  const totalPrice = input.basePrice + optionsTotal - discountAmount + travelFees;
  const depositAmount = Math.round(totalPrice * SERVICE_DEPOSIT_RATE);
  return { basePrice: input.basePrice, optionsTotal, discountPct, discountAmount, travelFees, totalPrice, depositAmount };
}

/** Montant TTC prêt à afficher — voir README.md § Ton rédactionnel (« montants suivis de TTC ou HT »). */
export function formatServicePrice(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} € TTC`;
}

/** Montant HT — pour les prix issus du vrai catalogue (`catalogue_offres.prix_ht`), jamais
 * convertis en TTC ici (aucune règle de TVA validée pour ce total combiné forfait+options), même
 * étiquetage honnête "€ HT" que le tunnel club (ClubServicesBoard/offerPriceLabel). */
export function formatServicePriceHT(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} € HT`;
}

/** "Sur devis" quand le montant est `null` — jamais un chiffre inventé pour une offre sans prix
 * fixe (`tarif_type = 'sur_devis'`). */
export function formatServicePriceHTOrDevis(amount: number | null): string {
  return amount === null ? "Sur devis" : formatServicePriceHT(amount);
}

/** `null` = prestation demandée mais pas encore chiffrée par le staff (montant_ttc absent en
 * base) — état normal, pas une erreur. Ne jamais afficher "0 € TTC" dans ce cas. */
export function formatServicePriceOrPending(amount: number | null): string {
  return amount === null ? "Non chiffré" : formatServicePrice(amount);
}

export function formatServiceDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export function formatServiceDateShort(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(iso));
}

/**
 * Droit de rétractation (article L221-18 du Code de la consommation) : une prestation
 * programmée dans moins de 14 jours nécessite une renonciation explicite du client pour être
 * exécutée avant la fin du délai légal. Même formule que le configurateur Projet vanilla
 * (projet-configurateur.js:needsRetractationWaiver) et create-guest-request (édge function
 * vitrine) — les deux autres points d'entrée qui écrivent dans `prestations` appliquent déjà
 * cette règle ; le tunnel Connect doit la reprendre à l'identique pour ne pas laisser un client
 * Espace Projet réserver une prestation imminente sans ce garde-fou légal.
 */
export function needsRetractationWaiver(dateIso: string): boolean {
  if (!dateIso) return false;
  const target = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  return diffDays >= 0 && diffDays < 14;
}

/** Décale une heure "HH:MM" de `delta` minutes (peut être négatif). Utilisé pour dériver le
 * déroulé heure par heure de l'onglet Planning à partir des horaires de la prestation. */
export function addMinutesToTime(time: string, delta: number): string {
  const parts = time.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const total = (h * 60 + m + delta + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Chaîne de statuts — voir README.md § Chaînes de statuts (« Prestation »).
 * `a_valider` correspond à la validation interne de la demande avant devis ;
 * `a_valider_livrables` correspond à la validation cliente après postproduction. Les deux
 * s'affichent sous le même libellé « À valider » (voir SERVICE_STATUS_LABELS) puisque le
 * README nomme littéralement les deux étapes ainsi ; ce sont deux statuts internes distincts
 * pour piloter des colonnes de kanban différentes.
 */
export type ServiceStatus =
  | "demande_recue"
  | "a_valider"
  | "devis_envoye"
  | "contrat_a_signer"
  | "paiement_en_attente"
  | "planifiee"
  | "en_cours"
  | "postproduction"
  | "a_valider_livrables"
  | "livree"
  | "terminee"
  | "annulee";

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  demande_recue: "Demande reçue",
  a_valider: "À valider",
  devis_envoye: "Devis envoyé",
  contrat_a_signer: "Contrat à signer",
  paiement_en_attente: "Paiement en attente",
  planifiee: "Planifiée",
  en_cours: "En cours",
  postproduction: "Postproduction",
  a_valider_livrables: "À valider",
  livree: "Livrée",
  terminee: "Terminée",
  annulee: "Annulée",
};

// Couleurs de badge — voir CHARTE.md § Badges de statut. Le tableau y cite littéralement
// « À valider » comme exemple de la ligne Violet (production), avec Planifiée et
// Postproduction : les deux statuts « À valider » de la chaîne Prestation suivent donc ce
// ton, pas le ton Orange (qui couvre « En attente, À signer, À payer, Corrections demandées »).
export const SERVICE_STATUS_TONE: Record<ServiceStatus, BadgeTone> = {
  demande_recue: "info",
  a_valider: "accent",
  devis_envoye: "info",
  contrat_a_signer: "warning",
  paiement_en_attente: "warning",
  planifiee: "accent",
  en_cours: "accent",
  postproduction: "accent",
  a_valider_livrables: "accent",
  livree: "success",
  terminee: "success",
  annulee: "danger",
};

export interface KanbanColumnDefinition {
  key: string;
  label: string;
  statuses: ServiceStatus[];
}

/**
 * Colonnes du kanban — voir ACTIONS.md § 12 : « Demande reçue, À valider, Devis envoyé,
 * Planifiée, Postproduction, Livrée ». Le kanban regroupe volontairement plusieurs statuts
 * fins dans une même colonne (ex. Contrat à signer + Paiement en attente sous « Devis envoyé »)
 * pour rester à 6 colonnes ; le statut précis reste visible via le badge sur la carte et
 * dans l'onglet Historique de la fiche. `terminee` et `annulee` sortent du pilotage actif et
 * n'apparaissent que dans la vue Liste.
 */
export const KANBAN_COLUMNS: KanbanColumnDefinition[] = [
  { key: "demande_recue", label: "Demande reçue", statuses: ["demande_recue"] },
  { key: "a_valider", label: "À valider", statuses: ["a_valider"] },
  { key: "devis_envoye", label: "Devis envoyé", statuses: ["devis_envoye", "contrat_a_signer", "paiement_en_attente"] },
  { key: "planifiee", label: "Planifiée", statuses: ["planifiee", "en_cours"] },
  { key: "postproduction", label: "Postproduction", statuses: ["postproduction", "a_valider_livrables"] },
  { key: "livree", label: "Livrée", statuses: ["livree", "terminee"] },
];

export function getKanbanColumnKey(status: ServiceStatus): string | null {
  if (status === "annulee") return null;
  return KANBAN_COLUMNS.find((c) => c.statuses.includes(status))?.key ?? null;
}

export interface ServiceBrief {
  objective: string;
  constraints?: string;
  references?: string;
  toAvoid?: string;
}

export interface ServiceTeamMember {
  id: string;
  name: string;
  role: string;
  side: "sportvision" | "client";
  phone?: string;
  email?: string;
}

export type DeliverableStatus = "planned" | "option_selected" | "in_production" | "delivered";

export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  planned: "Prévu",
  option_selected: "Option choisie",
  in_production: "En production",
  delivered: "Livré",
};

export interface Deliverable {
  id: string;
  serviceId: string;
  label: string;
  quantity?: number;
  status: DeliverableStatus;
  mediaAssetIds: string[];
}

export interface Milestone {
  id: string;
  serviceId: string;
  label: string;
  dueDate: string;
  completedAt?: string;
  order: number;
}

export interface ServiceFile {
  id: string;
  serviceId: string;
  name: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: string;
}

export interface ServiceHistoryEntry {
  id: string;
  serviceId: string;
  label: string;
  actorName: string;
  createdAt: string;
}

export interface ServiceMessage {
  id: string;
  serviceId: string;
  authorName: string;
  authorSide: "sportvision" | "client";
  body: string;
  createdAt: string;
}

export interface Service {
  id: string;
  reference: string; // PRE-AAAA-NNNN
  organizationId: string;
  serviceType: ServiceType;
  date: string;
  startTime: string;
  endTime: string;
  address: string;
  teamId?: string;
  eventId?: string;
  onSiteContactName: string;
  onSiteContactPhone: string;
  brief: ServiceBrief;
  optionCodes: ServiceOptionCode[];
  /** `null` = pas encore chiffré par le staff (voir formatServicePriceOrPending). */
  basePrice: number | null;
  optionsTotal: number;
  discountAmount: number;
  travelFees: number;
  /** `null` = pas encore chiffré par le staff (voir formatServicePriceOrPending). */
  totalPrice: number | null;
  depositAmount: number;
  depositMethod?: "card" | "cash";
  depositPaidAt?: string;
  balancePaidAt?: string;
  status: ServiceStatus;
  progressPercent: number;
  operatorIds: string[];
  isIncludedInPlan: boolean;
  createdAt: string;
  team: ServiceTeamMember[];
  milestones: Milestone[];
  deliverables: Deliverable[];
  files: ServiceFile[];
  history: ServiceHistoryEntry[];
  messages: ServiceMessage[];
  horairesConfirmed: boolean;
  quoteUrl?: string;
  depositInvoiceUrl?: string;
}
