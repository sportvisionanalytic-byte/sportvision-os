// Entités du périmètre Studio Club+ / Newsroom / Match Center / Demandes de visuels.
// Voir ../../../../context/import/SportVision-Connect-Design/DATA_MODEL.md pour le modèle de
// référence (StudioTemplate, VisualRequest, NewsroomItem, Match). Fichier propre à ce module,
// séparé de src/lib/types.ts pour ne pas entrer en conflit avec un autre agent.

import type { BadgeTone } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------------------------
// Studio — modèles de création (marketplace)
// ---------------------------------------------------------------------------------------------

export type StudioCategory =
  | "pre_match"
  | "match_day"
  | "post_match"
  | "players"
  | "club_life"
  | "sponsors"
  | "events";

export const STUDIO_CATEGORY_LABELS: Record<StudioCategory, string> = {
  pre_match: "Avant-match",
  match_day: "Jour de match",
  post_match: "Après-match",
  players: "Joueurs",
  club_life: "Vie du club",
  sponsors: "Sponsors",
  events: "Événements",
};

export const STUDIO_CATEGORY_ORDER: StudioCategory[] = [
  "pre_match",
  "match_day",
  "post_match",
  "players",
  "club_life",
  "sponsors",
  "events",
];

/** Clé de champ de formulaire — voir ACTIONS.md § 6 « Fiche modèle ». */
export type StudioFieldKey =
  | "team"
  | "opponent"
  | "competition"
  | "date"
  | "venue"
  | "sponsor"
  | "player"
  | "title"
  | "photo"
  | "comment";

export const STUDIO_FIELD_LABELS: Record<StudioFieldKey, string> = {
  team: "Équipe",
  opponent: "Adversaire",
  competition: "Compétition",
  date: "Date",
  venue: "Lieu",
  sponsor: "Sponsor",
  player: "Joueur",
  title: "Titre / objet",
  photo: "Photo",
  comment: "Commentaire",
};

/** Champs préremplis automatiquement pour tout modèle — voir ACTIONS.md § 6. */
export const STUDIO_PREFILLED_FIELDS = ["Club", "Logo", "Couleurs du club", "Sponsors", "Saison"] as const;

export interface StudioTemplate {
  code: string;
  name: string;
  category: StudioCategory;
  /**
   * 1 à 3 crédits. Non communiqué par le client modèle par modèle (seul le total 40 crédits/mois
   * de Club+ Performance est confirmé) : coût attribué ici selon la complexité perçue du gabarit
   * (poster multi-éléments = 2-3, visuel simple = 1) — décision de la maquette, à faire valider.
   */
  creditCost: 1 | 2 | 3;
  deliveryDelay: "24 h" | "48 h" | "72 h";
  previewUrl: string;
  sampleUrls: [string, string, string];
  formFields: StudioFieldKey[];
  prefilledFields: readonly string[];
  minTier: 2;
}

// ---------------------------------------------------------------------------------------------
// VisualRequest — demandes de visuels
// ---------------------------------------------------------------------------------------------

/**
 * DATA_MODEL.md § VisualRequest annonce 12 valeurs pour `visualType` mais ACTIONS.md § 11 parle
 * de « 11 types de visuel » dans la modale — décalage non résolu par la documentation. Le modèle
 * de données fait foi : 12 valeurs ci-dessous, toutes proposées dans le sélecteur de la modale.
 */
export type VisualType =
  | "matchday_poster"
  | "lineup"
  | "match_result"
  | "player_highlight"
  | "player_announcement"
  | "club_announcement"
  | "sponsor_content"
  | "event_promo"
  | "birthday"
  | "recruitment"
  | "social_story"
  | "other";

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  matchday_poster: "Affiche de match",
  lineup: "Composition d'équipe",
  match_result: "Résultat",
  player_highlight: "Mise en avant joueur",
  player_announcement: "Annonce joueur",
  club_announcement: "Communiqué du club",
  sponsor_content: "Contenu sponsor",
  event_promo: "Communication événement",
  birthday: "Anniversaire",
  recruitment: "Recrutement",
  social_story: "Story réseaux sociaux",
  other: "Autre",
};

export type VisualFormat = "post_1_1" | "story_9_16" | "reel_9_16" | "banner_16_9";

export const VISUAL_FORMAT_LABELS: Record<VisualFormat, string> = {
  post_1_1: "Post carré (1:1)",
  story_9_16: "Story (9:16)",
  reel_9_16: "Reel (9:16)",
  banner_16_9: "Bannière (16:9)",
};

export type VisualPlatform = "instagram" | "tiktok" | "facebook" | "website" | "print";

export const VISUAL_PLATFORM_LABELS: Record<VisualPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  website: "Site web",
  print: "Impression",
};

export type VisualRequestUrgency = "standard" | "priority" | "express";

export const URGENCY_META: Record<
  VisualRequestUrgency,
  { label: string; creditCost: number; delayLabel: string }
> = {
  standard: { label: "Standard", creditCost: 1, delayLabel: "5 jours" },
  priority: { label: "Prioritaire", creditCost: 2, delayLabel: "48 heures" },
  express: { label: "Express", creditCost: 3, delayLabel: "24 heures" },
};

/** Chaîne de statuts — voir README.md § Chaînes de statuts « Demande ». */
export type VisualRequestStatus =
  | "Brouillon"
  | "Envoyée"
  | "À compléter"
  | "Acceptée"
  | "En traitement"
  | "En production"
  | "À valider"
  | "Correction"
  | "Terminée"
  | "Refusée"
  | "Annulée";

/** Puce de statut — couleur + libellé, voir CHARTE.md § Badges de statut. */
export const VISUAL_REQUEST_STATUS_TONE: Record<VisualRequestStatus, BadgeTone> = {
  Brouillon: "neutral",
  Envoyée: "info",
  "À compléter": "warning",
  Acceptée: "success",
  "En traitement": "info",
  "En production": "accent",
  "À valider": "accent",
  Correction: "warning",
  Terminée: "success",
  Refusée: "danger",
  Annulée: "danger",
};

export interface RequestAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
}

export interface VisualRequest {
  id: string;
  /** `VIS-AAAA-NNNN` */
  reference: string;
  organizationId: string;
  requestedById: string;
  requestedByName: string;
  assigneeId?: string;
  /** Renseigné si la demande a été créée depuis le Studio. */
  templateCode?: string;
  visualType: VisualType;
  teamId?: string;
  teamName?: string;
  eventId?: string;
  eventName?: string;
  sponsorId?: string;
  sponsorName?: string;
  publishDate: string;
  format: VisualFormat;
  platform: VisualPlatform;
  bodyText?: string;
  urgency: VisualRequestUrgency;
  creditsReserved: number;
  status: VisualRequestStatus;
  /** 2 corrections incluses, la 3ᵉ facturée — voir ACTIONS.md § 13. */
  revisionCount: number;
  dueAt: string;
  attachments: RequestAttachment[];
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// NewsroomItem — remontées des équipes
// ---------------------------------------------------------------------------------------------

export type NewsroomStatus = "received" | "to_process" | "info_requested" | "transformed" | "archived";

export const NEWSROOM_STATUS_LABELS: Record<NewsroomStatus, string> = {
  received: "Reçu",
  to_process: "À traiter",
  info_requested: "Complément demandé",
  transformed: "Transformé",
  archived: "Archivé",
};

export const NEWSROOM_STATUS_TONE: Record<NewsroomStatus, BadgeTone> = {
  received: "info",
  to_process: "warning",
  info_requested: "warning",
  transformed: "success",
  archived: "neutral",
};

export interface NewsroomItem {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  submittedById: string;
  submittedByName: string;
  teamId?: string;
  teamName?: string;
  status: NewsroomStatus;
  transformedIntoType?: "publication" | "visual_request";
  transformedIntoId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Match — Match Center
// ---------------------------------------------------------------------------------------------

// "postponed"/"cancelled" (migration-clubplus-v37, colonnes club_matches.status 'reportee'/
// 'annulee') : le statut existe désormais en base et s'affiche proprement (label + couleur),
// mais aucune action UI ne permet encore de les déclencher depuis Club+ dans ce chantier — voir
// data/club/matches.ts § STATUS_MAP. Le workflow complet (qui peut reporter/annuler un match,
// depuis quel écran) reste à construire séparément.
export type MatchStatus = "upcoming" | "result_pending" | "result_received" | "content_created" | "postponed" | "cancelled";

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  upcoming: "À venir",
  result_pending: "À transmettre",
  result_received: "Reçu",
  content_created: "Contenu créé",
  postponed: "Reporté",
  cancelled: "Annulé",
};

export const MATCH_STATUS_TONE: Record<MatchStatus, BadgeTone> = {
  upcoming: "info",
  result_pending: "warning",
  result_received: "success",
  content_created: "accent",
  postponed: "warning",
  cancelled: "danger",
};

export interface MatchScorer {
  playerName: string;
  minute?: number;
}

/**
 * Champs additionnels du formulaire complet (14 champs) au-delà des colonnes du modèle Match de
 * DATA_MODEL.md — non listés individuellement par la source, complétés ici pour un formulaire de
 * feuille de match réaliste (passeurs, cartons, affluence, commentaire du coach).
 */
export interface MatchExtendedReport {
  assists?: string;
  cards?: string;
  attendance?: number;
  comment?: string;
}

export interface Match {
  id: string;
  organizationId: string;
  teamId: string;
  teamName: string;
  opponent: string;
  competition: string;
  kickoffAt: string;
  venue: string;
  isHome: boolean;
  scoreFor?: number;
  scoreAgainst?: number;
  scorers?: MatchScorer[];
  manOfTheMatch?: string;
  status: MatchStatus;
  extendedReport?: MatchExtendedReport;
}
