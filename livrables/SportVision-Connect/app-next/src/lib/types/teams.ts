// Entités du module Équipes — voir DATA_MODEL.md § Team, Player, ImageRight et § Affiliation.
// Ce fichier vit à part de src/lib/types.ts pour ne jamais entrer en conflit avec un autre agent
// qui travaille en parallèle sur un autre module (voir README.md § Conventions).

export type LicenseStatus = "valid" | "pending" | "expired" | "missing";

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  season: string;
  headCoachName: string;
  assistantCoachNames?: string[];
  playerCount: number;
  trainingSlots?: string;
  venue?: string;
}

/** 5 périmètres indépendants — voir DATA_MODEL.md § ImageRight et ACTIONS.md § 20 « Autorisations ». */
export interface ImageRightScopes {
  teamAndMatchPhotos: boolean;
  videosAndHighlights: boolean;
  individualPortraits: boolean;
  commercialUse: boolean;
  offClubDistribution: boolean;
}

export type ImageRightStatus = "signed" | "pending" | "refused" | "withdrawn";

export interface ImageRight {
  playerId: string;
  status: ImageRightStatus;
  signedByName?: string;
  signedAt?: string;
  documentId?: string;
  scopes: ImageRightScopes;
  validUntil?: string;
}

export interface Player {
  id: string;
  organizationId: string;
  teamId: string;
  userId?: string;
  /** Renseigné quand le joueur dispose de son propre espace (organisation de type `player`). */
  playerOrganizationId?: string;
  firstName: string;
  lastName: string;
  shirtNumber?: number;
  position?: string;
  licenseStatus: LicenseStatus;
  medicalCertificateAt?: string;
  contentCount: number;
}

export type AffiliationStatus = "active" | "ended" | "transferred";

export interface Affiliation {
  playerId: string;
  organizationId: string;
  teamId: string;
  season: string;
  startsAt: string;
  endsAt?: string;
  status: AffiliationStatus;
}

/** Léger aperçu calendrier propre à la fiche équipe — pas le module /calendar complet. */
export interface TeamCalendarEntry {
  id: string;
  teamId: string;
  label: string;
  kind: "match" | "training" | "shooting" | "event";
  date: string;
  location?: string;
  opponent?: string;
}

/** Vignette de contenu — aperçu léger pour l'onglet Contenus de la fiche équipe. */
export interface TeamContentPreview {
  id: string;
  teamId: string;
  label: string;
  kind: "photo" | "video";
  createdAt: string;
}

/** Ligne « Demandes » — aperçu léger pour l'onglet Demandes de la fiche équipe. */
export interface TeamRequestPreview {
  id: string;
  teamId: string;
  label: string;
  status: "envoyee" | "en_creation" | "a_valider" | "terminee";
  requestedAt: string;
}

/** Document propre à une équipe — sous-ensemble de DATA_MODEL.md § Document. */
export interface TeamDocument {
  id: string;
  teamId: string;
  name: string;
  kind: "roster" | "insurance" | "image_right" | "medical" | "other";
  status: "a_jour" | "a_completer" | "expire";
  updatedAt: string;
}

/** Club suivi par un CM externe — ACTIONS.md § 16 « Pour un CM externe, /teams devient Clubs suivis ». */
export interface FollowedClub {
  organizationId: string;
  clubName: string;
  publicationsCount: number;
  toValidateCount: number;
  progressPct: number;
  accessStatus: "active" | "restreint" | "en_attente";
}
