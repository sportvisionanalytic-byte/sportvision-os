import type {
  Sponsor,
  SponsorDeliverable,
  SponsorDocument,
  SponsorOperation,
  SponsorPublication,
} from "../types/sponsors";

// Données fictives mais réalistes — voir README.md § Fidélité. « Varenne Auto » sponsorise US
// Varenne et dispose aussi de son propre espace partenaire (organisation `org-varenneauto`,
// voir mock-data.ts) — c'est le même partenariat vu des deux côtés : club et sponsor.

export const mockSponsors: Sponsor[] = [
  {
    id: "sponsor-varenne-auto",
    organizationId: "org-usv",
    name: "Varenne Auto",
    level: "or",
    startsAt: "2025-11-03",
    endsAt: "2026-11-03",
    annualAmount: 8000,
    paymentSchedule: "annual",
    status: "active",
    contractId: "contract-usv-sponsor-varenne-auto",
    signatories: ["Nadia Costa — Varenne Auto"],
    sector: "Concession automobile",
    commitments: [],
  },
  {
    id: "sponsor-credit-fontaine",
    organizationId: "org-usv",
    name: "Crédit Fontaine",
    level: "platine",
    startsAt: "2025-11-03",
    endsAt: "2026-11-03",
    annualAmount: 15000,
    paymentSchedule: "biannual",
    status: "active",
    signatories: ["Rémi Salomon — Crédit Fontaine"],
    sector: "Banque",
    commitments: [],
  },
  {
    id: "sponsor-boulangerie-du-stade",
    organizationId: "org-fcf",
    name: "Boulangerie du Stade",
    level: "argent",
    startsAt: "2025-09-01",
    endsAt: "2026-09-01",
    annualAmount: 3500,
    paymentSchedule: "quarterly",
    status: "active",
    signatories: ["Isabelle Roy — Boulangerie du Stade"],
    sector: "Boulangerie-pâtisserie",
    commitments: [],
  },
  {
    id: "sponsor-bricolage-plus",
    organizationId: "org-fcf",
    name: "Bricolage Plus",
    level: "bronze",
    startsAt: "2025-09-01",
    endsAt: "2026-09-01",
    annualAmount: 1800,
    paymentSchedule: "annual",
    status: "to_renew",
    signatories: ["Franck Auger — Bricolage Plus"],
    sector: "Bricolage et jardinage",
    commitments: [],
  },
];

export const mockSponsorDeliverables: SponsorDeliverable[] = [
  { id: "sd-1", sponsorId: "sponsor-varenne-auto", label: "Logo sur maillot domicile", period: "Saison 2026/2027", plannedCount: 22, deliveredCount: 22, status: "livre" },
  { id: "sd-2", sponsorId: "sponsor-varenne-auto", label: "Story Instagram mensuelle", period: "Août 2026", plannedCount: 4, deliveredCount: 2, status: "en_cours" },
  { id: "sd-3", sponsorId: "sponsor-varenne-auto", label: "Bâche stade — jours de match", period: "Saison 2026/2027", plannedCount: 12, deliveredCount: 9, status: "en_cours" },
  { id: "sd-4", sponsorId: "sponsor-credit-fontaine", label: "Panneau LED bord de terrain", period: "Saison 2026/2027", plannedCount: 12, deliveredCount: 12, status: "livre" },
  { id: "sd-5", sponsorId: "sponsor-credit-fontaine", label: "Interview trimestrielle", period: "T3 2026", plannedCount: 1, deliveredCount: 0, status: "planifie" },
  { id: "sd-6", sponsorId: "sponsor-boulangerie-du-stade", label: "Logo pied de page newsletter", period: "Saison 2026/2027", plannedCount: 10, deliveredCount: 7, status: "en_cours" },
  { id: "sd-7", sponsorId: "sponsor-bricolage-plus", label: "Bâche stade", period: "Saison 2025/2026", plannedCount: 8, deliveredCount: 5, status: "en_retard" },
];

export const mockSponsorPublications: SponsorPublication[] = [
  { id: "sp-1", sponsorId: "sponsor-varenne-auto", label: "Affiche Matchday — logo Varenne Auto", status: "publie", publishedAt: "2026-08-05", reach: 3200 },
  { id: "sp-2", sponsorId: "sponsor-varenne-auto", label: "Story reprise des entraînements", status: "programme" },
  { id: "sp-3", sponsorId: "sponsor-credit-fontaine", label: "Portrait joueur du mois", status: "publie", publishedAt: "2026-07-30", reach: 2100 },
  { id: "sp-4", sponsorId: "sponsor-boulangerie-du-stade", label: "Récap de match — logo pied de publication", status: "en_creation" },
];

export const mockSponsorOperations: SponsorOperation[] = [
  { id: "so-1", sponsorId: "sponsor-varenne-auto", label: "Stand véhicule au stade — journée d'ouverture", date: "2026-08-16", status: "prevue" },
  { id: "so-2", sponsorId: "sponsor-varenne-auto", label: "Remise des maillots floqués", date: "2026-07-20", status: "realisee" },
  { id: "so-3", sponsorId: "sponsor-credit-fontaine", label: "Tirage au sort partenaire — mi-temps", date: "2026-08-16", status: "prevue" },
];

export const mockSponsorDocuments: SponsorDocument[] = [
  { id: "sdoc-1", sponsorId: "sponsor-varenne-auto", name: "Contrat de partenariat 2025-2026", kind: "contract", updatedAt: "2025-10-20" },
  { id: "sdoc-2", sponsorId: "sponsor-varenne-auto", name: "Charte graphique Varenne Auto", kind: "brand_guidelines", updatedAt: "2025-11-03" },
  { id: "sdoc-3", sponsorId: "sponsor-varenne-auto", name: "Pack logos HD", kind: "logo_pack", updatedAt: "2025-11-03" },
  { id: "sdoc-4", sponsorId: "sponsor-credit-fontaine", name: "Contrat de partenariat 2025-2026", kind: "contract", updatedAt: "2025-10-28" },
];

/** Une organisation de type `sponsor` (son propre espace) peut être liée à un ou plusieurs
 * partenariats côté club — voir ACTIONS.md § 20 bis. */
export const mockSponsorSelfView: Record<string, string[]> = {
  "org-varenneauto": ["sponsor-varenne-auto"],
};

export function sponsorsForOrganization(organizationId: string): Sponsor[] {
  return mockSponsors.filter((s) => s.organizationId === organizationId);
}

export function deliverablesForSponsor(sponsorId: string): SponsorDeliverable[] {
  return mockSponsorDeliverables.filter((d) => d.sponsorId === sponsorId);
}

// `null` = aucun livrable suivi pour ce sponsor (cas de tout sponsor réel : SponsorDeliverable
// n'a pas de table backend, voir data/club/sponsors.ts). À ne jamais confondre avec 0 % — 0 %
// affirmerait « rien n'a été livré » alors qu'on ne suit tout simplement rien. Les appelants
// doivent afficher "Non suivi" plutôt qu'un pourcentage fabriqué quand la valeur est `null`.
export function visibilityGauge(sponsorId: string): number | null {
  const items = deliverablesForSponsor(sponsorId);
  if (items.length === 0) return null;
  const planned = items.reduce((sum, d) => sum + d.plannedCount, 0);
  const delivered = items.reduce((sum, d) => sum + d.deliveredCount, 0);
  return planned > 0 ? Math.round((delivered / planned) * 100) : 0;
}
