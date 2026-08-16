import type { SponsorDeliverable } from "../types/sponsors";

// Données fictives — voir README.md § Fidélité. Réduit le 16/08/2026 (chantier "Studio dynamique
// + Sponsors backend réel") : mockSponsors/mockSponsorPublications/mockSponsorOperations/
// mockSponsorDocuments/mockSponsorSelfView/sponsorsForOrganization retirés, plus aucun appelant
// ne les utilisait (fetchClubSponsors/fetchSponsorPartnerships lisent déjà club_sponsors réel
// depuis longtemps ; Publications et Opérations ont désormais un vrai backend, voir
// data/club/sponsors.ts). SponsorDeliverable reste en mock : aucune table backend pour cette
// entité (hors périmètre de ce chantier, voir son rapport) — fichier conservé pour cette seule
// raison, pas supprimé.

export const mockSponsorDeliverables: SponsorDeliverable[] = [
  { id: "sd-1", sponsorId: "sponsor-varenne-auto", label: "Logo sur maillot domicile", period: "Saison 2026/2027", plannedCount: 22, deliveredCount: 22, status: "livre" },
  { id: "sd-2", sponsorId: "sponsor-varenne-auto", label: "Story Instagram mensuelle", period: "Août 2026", plannedCount: 4, deliveredCount: 2, status: "en_cours" },
  { id: "sd-3", sponsorId: "sponsor-varenne-auto", label: "Bâche stade — jours de match", period: "Saison 2026/2027", plannedCount: 12, deliveredCount: 9, status: "en_cours" },
  { id: "sd-4", sponsorId: "sponsor-credit-fontaine", label: "Panneau LED bord de terrain", period: "Saison 2026/2027", plannedCount: 12, deliveredCount: 12, status: "livre" },
  { id: "sd-5", sponsorId: "sponsor-credit-fontaine", label: "Interview trimestrielle", period: "T3 2026", plannedCount: 1, deliveredCount: 0, status: "planifie" },
  { id: "sd-6", sponsorId: "sponsor-boulangerie-du-stade", label: "Logo pied de page newsletter", period: "Saison 2026/2027", plannedCount: 10, deliveredCount: 7, status: "en_cours" },
  { id: "sd-7", sponsorId: "sponsor-bricolage-plus", label: "Bâche stade", period: "Saison 2025/2026", plannedCount: 8, deliveredCount: 5, status: "en_retard" },
];

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
