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
  // `null` = non tracké côté backend réel (club_sponsors n'a pas cette colonne, voir
  // data/club/sponsors.ts) — ne jamais combler avec une valeur par défaut affichée comme un fait.
  paymentSchedule: PaymentSchedule | null;
  status: SponsorStatus;
  contractId?: string;
  signatories: string[];
  sector?: string;
  commitments: SponsorCommitment[];
  // club_sponsors.logo_url (migration-clubplus-v53) — null si jamais uploadé.
  logoUrl: string | null;
  // club_sponsors.content_type_obligations (migration-club-sponsors-content-obligations,
  // 03/09/2026) — types de contenu (valeurs contenus.type_contenu côté OS, ex. "Matchday") où ce
  // sponsor doit obligatoirement apparaître. Tableau vide = aucune obligation automatique.
  contentTypeObligations: string[];
}

/** Contrepartie suivie dans le temps — club_sponsors.commitments (jsonb, migration-clubplus-v5.sql).
 * Table vide en prod au 11/08/2026, aucune UI d'écriture existante ailleurs (ni Connect legacy,
 * ni OS, qui garde ce champ en lecture seule) : forme définie ici par ce module, pas déduite de
 * données réelles inexistantes. */
export interface SponsorCommitment {
  id: string;
  label: string;
  done: boolean;
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
