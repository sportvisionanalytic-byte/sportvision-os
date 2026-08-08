// Entités du module Bibliothèque de contenus — voir DATA_MODEL.md § MediaAsset / Collection et
// ACTIONS.md § 13. Fichier propre à ce module (voir README.md § Conventions).

import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Types de média — DATA_MODEL.md annonce « 10 types de contenu » sans les énumérer.
 * DÉCISION — liste retenue en cohérence avec les filtres de la bibliothèque (ACTIONS.md § 13 :
 * Tous · Photos · Vidéos · Reels · Affiches · Documents) : chaque filtre regroupe un ou
 * plusieurs `kind`, voir `MEDIA_FILTER_GROUPS` plus bas.
 */
export type MediaAssetKind =
  | "photo"
  | "raw_photo"
  | "video"
  | "raw_video"
  | "reel"
  | "story"
  | "highlight"
  | "poster"
  | "document"
  | "audio";

export const MEDIA_KIND_LABELS: Record<MediaAssetKind, string> = {
  photo: "Photo",
  raw_photo: "Photo brute",
  video: "Vidéo",
  raw_video: "Vidéo brute",
  reel: "Reel",
  story: "Story",
  highlight: "Highlight",
  poster: "Affiche",
  document: "Document",
  audio: "Audio",
};

export type MediaFilterKey = "all" | "photos" | "videos" | "reels" | "posters" | "documents";

export const MEDIA_FILTERS: { key: MediaFilterKey; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "photos", label: "Photos" },
  { key: "videos", label: "Vidéos" },
  { key: "reels", label: "Reels" },
  { key: "posters", label: "Affiches" },
  { key: "documents", label: "Documents" },
];

const MEDIA_FILTER_GROUPS: Record<Exclude<MediaFilterKey, "all">, MediaAssetKind[]> = {
  photos: ["photo", "raw_photo"],
  videos: ["video", "raw_video", "highlight", "audio"],
  reels: ["reel", "story"],
  posters: ["poster"],
  documents: ["document"],
};

export function matchesMediaFilter(kind: MediaAssetKind, filter: MediaFilterKey): boolean {
  if (filter === "all") return true;
  return MEDIA_FILTER_GROUPS[filter].includes(kind);
}

export type MediaStorageOrigin = "sportvision_delivered" | "club_storage" | "external_link";
export type MediaVisibility = "private" | "organization" | "team" | "player" | "public";
export type MediaAssetStatus = "to_validate" | "validated" | "revision_requested" | "raw_authorised";

export const MEDIA_STATUS_LABELS: Record<MediaAssetStatus, string> = {
  to_validate: "À valider",
  validated: "Validé",
  revision_requested: "Correction demandée",
  raw_authorised: "Brut autorisé",
};

// Couleurs de badge — voir CHARTE.md § Badges de statut. « À valider » suit le ton Violet
// (exemple littéral de la ligne « production »), « Correction demandée » suit le ton Orange
// (exemple littéral « Corrections demandées » de la ligne « action attendue »).
export const MEDIA_STATUS_TONE: Record<MediaAssetStatus, BadgeTone> = {
  to_validate: "accent",
  validated: "success",
  revision_requested: "warning",
  raw_authorised: "neutral",
};

export interface MediaChapter {
  id: string;
  label: string;
  startSeconds: number;
}

export interface MediaComment {
  id: string;
  mediaAssetId: string;
  authorName: string;
  body: string;
  videoTimestampSeconds?: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface MediaVersion {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  isFinalVersion: boolean;
}

export interface MediaAsset {
  id: string;
  organizationId: string;
  name: string;
  kind: MediaAssetKind;
  mimeType: string;
  fileUrl: string;
  thumbnailUrl: string;
  sizeBytes: number;
  aspectRatio: string;
  durationSeconds?: number;
  serviceId?: string;
  visualRequestId?: string;
  eventId?: string;
  teamId?: string;
  authorId?: string;
  authorName?: string;
  storageOrigin: MediaStorageOrigin;
  externalUrl?: string;
  externalExpiresAt?: string;
  usageRights: string;
  visibility: MediaVisibility;
  downloadAllowed: boolean;
  availableUntil?: string;
  version: number;
  isFinalVersion: boolean;
  previousVersionId?: string;
  status: MediaAssetStatus;
  tags: string[];
  createdAt: string;
  revisionCount: number;
  chapters: MediaChapter[];
  comments: MediaComment[];
  versions: MediaVersion[];
}

/** Table de liaison — alimente la vue filtrée du joueur et du parent (DATA_MODEL.md). */
export interface MediaAssetPlayer {
  mediaAssetId: string;
  playerId: string;
}

/**
 * Types de collection — DATA_MODEL.md annonce « 9 valeurs » sans les énumérer.
 * DÉCISION — liste réaliste couvrant les usages du produit (match, saison, événement...).
 */
export type CollectionKind =
  | "match"
  | "training"
  | "event"
  | "season_highlights"
  | "player_portfolio"
  | "sponsor"
  | "camp"
  | "tournament"
  | "custom";

export const COLLECTION_KIND_LABELS: Record<CollectionKind, string> = {
  match: "Match",
  training: "Entraînement",
  event: "Événement",
  season_highlights: "Temps forts de saison",
  player_portfolio: "Portfolio joueur",
  sponsor: "Sponsor",
  camp: "Stage",
  tournament: "Tournoi",
  custom: "Personnalisée",
};

export interface Collection {
  id: string;
  organizationId: string;
  name: string;
  kind: CollectionKind;
  coverAssetId?: string;
  assetIds: string[];
  itemCount: number;
  date?: string;
  teamId?: string;
  ownerId: string;
  ownerName: string;
  visibility: MediaVisibility;
  shareToken?: string;
  shareExpiresAt?: string;
}

export function formatMediaSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} Go`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} Mo`;
  return `${Math.round(bytes / 1_000)} Ko`;
}

export function formatMediaDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatMediaDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}
