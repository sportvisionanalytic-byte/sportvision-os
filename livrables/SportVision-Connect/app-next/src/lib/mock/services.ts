import type { Service, ServiceOptionCode, ServiceStatus, ServiceType } from "@/lib/types/services";
import { computeServicePricing } from "@/lib/types/services";
import type { PlanCode } from "@/lib/types";

// Données fictives mais réalistes — voir README.md § Fidélité. Rattachées aux organisations de
// src/lib/mock-data.ts (org-fcf, org-usv, org-lucas). À remplacer par de vraies requêtes quand
// le backend sera choisi (décision séparée, voir app-next/README.md).

interface BuildServiceInput {
  id: string;
  reference: string;
  organizationId: string;
  organizationAddress?: string;
  planCode: PlanCode;
  serviceType: ServiceType;
  status: ServiceStatus;
  date: string;
  startTime: string;
  endTime: string;
  address: string;
  optionCodes?: ServiceOptionCode[];
  isIncludedInPlan?: boolean;
  progressPercent?: number;
  horairesConfirmed?: boolean;
  onSiteContactName?: string;
  onSiteContactPhone?: string;
}

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function buildService(input: BuildServiceInput): Service {
  const pricing = computeServicePricing({
    serviceType: input.serviceType,
    optionCodes: input.optionCodes ?? [],
    planCode: input.planCode,
    address: input.address,
    organizationAddress: input.organizationAddress,
  });

  const serviceId = input.id;

  return {
    id: serviceId,
    reference: input.reference,
    organizationId: input.organizationId,
    serviceType: input.serviceType,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    address: input.address,
    onSiteContactName: input.onSiteContactName ?? "Sophie Martin",
    onSiteContactPhone: input.onSiteContactPhone ?? "06 12 34 56 78",
    brief: {
      objective: "Mettre en valeur l'équipe et l'ambiance du club pour les réseaux et le site.",
      constraints: "Éviter les prises de vue face au soleil en fin d'après-midi.",
      references: "S'inspirer du dernier reportage livré en mars.",
      toAvoid: "Pas de gros plan sur les sponsors du terrain adverse.",
    },
    optionCodes: input.optionCodes ?? [],
    basePrice: pricing.basePrice,
    optionsTotal: pricing.optionsTotal,
    discountAmount: pricing.discountAmount,
    travelFees: pricing.travelFees,
    totalPrice: pricing.totalPrice,
    depositAmount: pricing.depositAmount,
    depositMethod: "card",
    depositPaidAt: ["planifiee", "en_cours", "postproduction", "a_valider_livrables", "livree", "terminee"].includes(
      input.status,
    )
      ? "2026-07-28T10:15:00.000Z"
      : undefined,
    balancePaidAt: ["livree", "terminee"].includes(input.status) ? "2026-08-05T09:00:00.000Z" : undefined,
    status: input.status,
    progressPercent: input.progressPercent ?? 0,
    operatorIds: ["sv-theo-marchand"],
    isIncludedInPlan: input.isIncludedInPlan ?? false,
    createdAt: "2026-07-20T08:30:00.000Z",
    horairesConfirmed: input.horairesConfirmed ?? false,
    quoteUrl: "/documents/devis-exemple.pdf",
    depositInvoiceUrl: "/documents/facture-acompte-exemple.pdf",
    team: [
      { id: nextId("team"), name: "Théo Marchand", role: "Chargé de compte SportVision", side: "sportvision", email: "theo.marchand@sportvision.fr" },
      { id: nextId("team"), name: "Nina Berger", role: "Opérateur vidéo", side: "sportvision", phone: "06 45 12 33 90" },
      { id: nextId("team"), name: input.onSiteContactName ?? "Sophie Martin", role: "Contact sur place", side: "client", phone: input.onSiteContactPhone ?? "06 12 34 56 78" },
    ],
    milestones: [
      { id: nextId("ms"), serviceId, label: "Demande reçue", dueDate: "2026-07-20", completedAt: "2026-07-20T08:30:00.000Z", order: 1 },
      { id: nextId("ms"), serviceId, label: "Devis envoyé", dueDate: "2026-07-22", completedAt: ["devis_envoye", "contrat_a_signer", "paiement_en_attente", "planifiee", "en_cours", "postproduction", "a_valider_livrables", "livree", "terminee"].includes(input.status) ? "2026-07-22T14:00:00.000Z" : undefined, order: 2 },
      { id: nextId("ms"), serviceId, label: "Acompte réglé", dueDate: "2026-07-28", completedAt: ["planifiee", "en_cours", "postproduction", "a_valider_livrables", "livree", "terminee"].includes(input.status) ? "2026-07-28T10:15:00.000Z" : undefined, order: 3 },
      { id: nextId("ms"), serviceId, label: "Prestation réalisée", dueDate: input.date, completedAt: ["postproduction", "a_valider_livrables", "livree", "terminee"].includes(input.status) ? `${input.date}T${input.endTime}:00.000Z` : undefined, order: 4 },
      { id: nextId("ms"), serviceId, label: "Livraison", dueDate: "2026-08-10", completedAt: ["livree", "terminee"].includes(input.status) ? "2026-08-10T16:00:00.000Z" : undefined, order: 5 },
    ],
    deliverables: [
      { id: nextId("del"), serviceId, label: "Photos haute définition", quantity: 60, status: ["livree", "terminee"].includes(input.status) ? "delivered" : ["postproduction", "a_valider_livrables"].includes(input.status) ? "in_production" : "planned", mediaAssetIds: [] },
      { id: nextId("del"), serviceId, label: "Vidéo montée (2-3 min)", quantity: 1, status: ["livree", "terminee"].includes(input.status) ? "delivered" : ["postproduction", "a_valider_livrables"].includes(input.status) ? "in_production" : "planned", mediaAssetIds: [] },
      ...(input.optionCodes?.includes("reel")
        ? [{ id: nextId("del"), serviceId, label: "Reel réseaux sociaux", quantity: 1, status: "option_selected" as const, mediaAssetIds: [] }]
        : []),
      ...(input.optionCodes?.includes("highlight")
        ? [{ id: nextId("del"), serviceId, label: "Vidéo highlight", quantity: 1, status: "option_selected" as const, mediaAssetIds: [] }]
        : []),
    ],
    files: [
      { id: nextId("file"), serviceId, name: "Feuille de match.pdf", sizeBytes: 240_000, uploadedByName: "Sophie Martin", uploadedAt: "2026-07-21T09:12:00.000Z" },
      { id: nextId("file"), serviceId, name: "Liste des joueurs.xlsx", sizeBytes: 48_000, uploadedByName: "Sophie Martin", uploadedAt: "2026-07-21T09:14:00.000Z" },
    ],
    history: [
      { id: nextId("hist"), serviceId, label: "Demande créée", actorName: "Sophie Martin", createdAt: "2026-07-20T08:30:00.000Z" },
      { id: nextId("hist"), serviceId, label: "Demande validée par SportVision", actorName: "Théo Marchand", createdAt: "2026-07-21T11:00:00.000Z" },
      { id: nextId("hist"), serviceId, label: "Devis envoyé", actorName: "Théo Marchand", createdAt: "2026-07-22T14:00:00.000Z" },
    ],
    messages: [
      { id: nextId("msg"), serviceId, authorName: "Théo Marchand", authorSide: "sportvision", body: "Bonjour, votre devis est prêt, n'hésitez pas si vous avez des questions avant de le valider.", createdAt: "2026-07-22T14:05:00.000Z" },
      { id: nextId("msg"), serviceId, authorName: "Sophie Martin", authorSide: "client", body: "Merci, c'est noté, on revient vers vous rapidement.", createdAt: "2026-07-22T16:40:00.000Z" },
    ],
  };
}

export const mockServices: Service[] = [
  buildService({
    id: "srv-fcf-1",
    reference: "PRE-2026-0101",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "match_complet",
    status: "demande_recue",
    date: "2026-08-22",
    startTime: "14:00",
    endTime: "17:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
  }),
  buildService({
    id: "srv-fcf-2",
    reference: "PRE-2026-0098",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "portraits_joueurs",
    status: "a_valider",
    date: "2026-08-18",
    startTime: "18:00",
    endTime: "20:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    optionCodes: ["extra_photographer"],
  }),
  buildService({
    id: "srv-fcf-3",
    reference: "PRE-2026-0095",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "evenement_club",
    status: "devis_envoye",
    date: "2026-08-30",
    startTime: "19:00",
    endTime: "23:00",
    address: "Salle des fêtes, 77300 Fontainebleau",
    optionCodes: ["live_stories", "reel"],
  }),
  buildService({
    id: "srv-fcf-4",
    reference: "PRE-2026-0091",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "shooting_equipe",
    status: "contrat_a_signer",
    date: "2026-08-16",
    startTime: "10:00",
    endTime: "12:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
  }),
  buildService({
    id: "srv-fcf-5",
    reference: "PRE-2026-0088",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "captation_drone",
    status: "paiement_en_attente",
    date: "2026-08-14",
    startTime: "09:00",
    endTime: "10:30",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    optionCodes: ["drone"],
  }),
  buildService({
    id: "srv-fcf-6",
    reference: "PRE-2026-0082",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "entrainement",
    status: "planifiee",
    date: "2026-08-13",
    startTime: "18:30",
    endTime: "20:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    horairesConfirmed: false,
    progressPercent: 45,
  }),
  buildService({
    id: "srv-fcf-7",
    reference: "PRE-2026-0077",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "tournoi_stage",
    status: "en_cours",
    date: "2026-08-09",
    startTime: "09:00",
    endTime: "18:00",
    address: "Complexe sportif, 77300 Fontainebleau",
    optionCodes: ["drone", "reel", "express_delivery"],
    horairesConfirmed: true,
    progressPercent: 60,
  }),
  buildService({
    id: "srv-fcf-8",
    reference: "PRE-2026-0070",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "match_complet",
    status: "postproduction",
    date: "2026-08-02",
    startTime: "15:00",
    endTime: "18:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    optionCodes: ["highlight"],
    horairesConfirmed: true,
    progressPercent: 80,
  }),
  buildService({
    id: "srv-fcf-9",
    reference: "PRE-2026-0065",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "interview",
    status: "a_valider_livrables",
    date: "2026-07-30",
    startTime: "17:00",
    endTime: "18:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    optionCodes: ["interview"],
    horairesConfirmed: true,
    progressPercent: 90,
  }),
  buildService({
    id: "srv-fcf-10",
    reference: "PRE-2026-0060",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "contenu_reseaux",
    status: "livree",
    date: "2026-07-24",
    startTime: "10:00",
    endTime: "13:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    horairesConfirmed: true,
    progressPercent: 100,
  }),
  buildService({
    id: "srv-fcf-11",
    reference: "PRE-2026-0050",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "evenement_club",
    status: "terminee",
    date: "2026-07-10",
    startTime: "19:00",
    endTime: "22:00",
    address: "Salle des fêtes, 77300 Fontainebleau",
    horairesConfirmed: true,
    progressPercent: 100,
  }),
  buildService({
    id: "srv-fcf-12",
    reference: "PRE-2026-0045",
    organizationId: "org-fcf",
    organizationAddress: "Stade Pierre-Bardin, 77300 Fontainebleau",
    planCode: "club_plus_performance",
    serviceType: "shooting_equipe",
    status: "annulee",
    date: "2026-07-05",
    startTime: "10:00",
    endTime: "11:30",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
  }),
  buildService({
    id: "srv-usv-1",
    reference: "PRE-2026-0099",
    organizationId: "org-usv",
    organizationAddress: "Complexe sportif, 77130 Varenne",
    planCode: "full_communication",
    serviceType: "evenement_entreprise",
    status: "devis_envoye",
    date: "2026-08-28",
    startTime: "09:00",
    endTime: "18:00",
    address: "Complexe sportif, 77130 Varenne",
    isIncludedInPlan: true,
    onSiteContactName: "Marc Dubreuil",
    onSiteContactPhone: "06 78 90 12 34",
  }),
  buildService({
    id: "srv-lucas-1",
    reference: "PRE-2026-0040",
    organizationId: "org-lucas",
    planCode: "club_access",
    serviceType: "portraits_joueurs",
    status: "livree",
    date: "2026-07-18",
    startTime: "17:00",
    endTime: "18:00",
    address: "Stade Pierre-Bardin, 77300 Fontainebleau",
    horairesConfirmed: true,
    progressPercent: 100,
    onSiteContactName: "Lucas Mendes",
    onSiteContactPhone: "06 22 33 44 55",
  }),
];

export function getServicesForOrganization(organizationId: string): Service[] {
  return mockServices.filter((s) => s.organizationId === organizationId);
}

export function getServiceById(id: string): Service | undefined {
  return mockServices.find((s) => s.id === id);
}
