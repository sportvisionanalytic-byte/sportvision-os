// Entités du module Sponsors — voir DATA_MODEL.md § Sponsor. Fichier séparé de src/lib/types.ts
// par convention de non-conflit (voir README.md § Conventions pour construire un nouveau module).

export type SponsorLevel = "platine" | "or" | "argent" | "bronze";
export type SponsorStatus = "active" | "to_renew" | "expired";
export type PaymentSchedule = "annual" | "biannual" | "quarterly" | "monthly";

export interface Sponsor {
  id: string;
  organizationId: string;
  name: string;
  level: SponsorLevel;
  startsAt: string;
  endsAt: string;
  annualAmount: number;
  paymentSchedule: PaymentSchedule;
  status: SponsorStatus;
  contractId?: string;
  signatories: string[];
  sector?: string;
}

export type SponsorDeliverableStatus = "planifie" | "en_cours" | "livre" | "en_retard";

/** La jauge de visibilité = somme des deliveredCount / somme des plannedCount. */
export interface SponsorDeliverable {
  id: string;
  sponsorId: string;
  label: string;
  period: string;
  plannedCount: number;
  deliveredCount: number;
  status: SponsorDeliverableStatus;
}

export type SponsorPublicationStatus = "publie" | "programme" | "en_creation";

/** Publication où le logo du sponsor apparaît — aperçu léger, pas le module /content complet. */
export interface SponsorPublication {
  id: string;
  sponsorId: string;
  label: string;
  status: SponsorPublicationStatus;
  publishedAt?: string;
  reach?: number;
}

/** Activation prévue ou réalisée — onglet Livrables / espace partenaire « Opérations ». */
export interface SponsorOperation {
  id: string;
  sponsorId: string;
  label: string;
  date: string;
  status: "prevue" | "realisee";
}

/** Document propre à un sponsor — sous-ensemble de DATA_MODEL.md § Document. */
export interface SponsorDocument {
  id: string;
  sponsorId: string;
  name: string;
  kind: "contract" | "brand_guidelines" | "logo_pack" | "invoice" | "other";
  updatedAt: string;
}
