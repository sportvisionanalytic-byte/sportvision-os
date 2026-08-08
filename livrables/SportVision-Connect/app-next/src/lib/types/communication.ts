// Types du périmètre Full Communication — voir DATA_MODEL.md § Publication, § Report,
// § Thread et Message. Fichier propre à ce module (README.md § Conventions point 1) : n'ajoute
// rien à src/lib/types.ts pour ne jamais entrer en conflit avec un autre agent.

// ---------------------------------------------------------------------------------------------
// Publication — planning éditorial, validations, historique des publications
// ---------------------------------------------------------------------------------------------

/**
 * Chaîne de statuts — README.md § Chaînes de statuts.
 * Idée → À produire → En création → À valider → Corrections → Validé → Programmé → Publié
 * Exceptions hors frise : Erreur de publication · Annulée.
 */
export type PublicationStatus =
  | "idea"
  | "to_produce"
  | "in_creation"
  | "to_validate"
  | "corrections"
  | "validated"
  | "scheduled"
  | "published"
  | "publish_error"
  | "cancelled";

/** Ordre de la frise principale (hors exceptions) — utilisé par le stepper de la fiche publication. */
export const PUBLICATION_STATUS_FLOW: PublicationStatus[] = [
  "idea",
  "to_produce",
  "in_creation",
  "to_validate",
  "corrections",
  "validated",
  "scheduled",
  "published",
];

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  idea: "Idée",
  to_produce: "À produire",
  in_creation: "En création",
  to_validate: "À valider",
  corrections: "Corrections",
  validated: "Validé",
  scheduled: "Programmé",
  published: "Publié",
  publish_error: "Erreur de publication",
  cancelled: "Annulée",
};

export type PublicationPlatform = "instagram" | "tiktok" | "facebook" | "youtube";
export type PublicationFormat = "post" | "story" | "reel";

export const PLATFORM_LABELS: Record<PublicationPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
};

export const FORMAT_LABELS: Record<PublicationFormat, string> = {
  post: "Post",
  story: "Story",
  reel: "Reel",
};

export interface Publication {
  id: string;
  organizationId: string;
  title: string;
  platform: PublicationPlatform;
  format: PublicationFormat;
  /** Modifiée par le glisser-déposer du planning. Le statut ne change pas au déplacement. */
  scheduledAt: string;
  bodyText?: string;
  hashtags: string[];
  /** Nombre de médias attachés — la médiathèque (MediaAsset) n'est pas dans ce périmètre. */
  mediaCount: number;
  sponsorId?: string;
  teamId?: string;
  /** Nom lisible de l'auteur — pas de résolution d'utilisateur dans ce module mock. */
  ownerName: string;
  status: PublicationStatus;
  objective?: string;
  /** Nombre de corrections déjà demandées. Les deux premières sont incluses, la 3ᵉ facturée. */
  revisionCount: number;
  reach?: number;
  engagement?: number;
  views?: number;
  /**
   * Identifiant du post côté Metricool. Jargon technique — voir README.md § Ce que le client
   * ne doit jamais voir. Ne JAMAIS afficher ce champ dans l'interface.
   */
  externalPostId?: string;
}

export interface PublicationComment {
  id: string;
  publicationId: string;
  authorName: string;
  authorSide: "client" | "sportvision";
  body: string;
  createdAt: string;
}

export interface PublicationHistoryEntry {
  id: string;
  publicationId: string;
  toStatus: PublicationStatus;
  actorName: string;
  at: string;
}

/** Urgence dérivée de l'échéance — utilisée par la file de validation, jamais stockée. */
export type ValidationUrgency = "normal" | "urgent";

export function computeValidationUrgency(scheduledAt: string): ValidationUrgency {
  const hoursLeft = (new Date(scheduledAt).getTime() - Date.now()) / 3_600_000;
  return hoursLeft <= 48 ? "urgent" : "normal";
}

// Statuts affichés dans le tableau d'historique des publications (ACTIONS.md § 9 /publications).
// Le tableau ne montre que 4 statuts au client ; tout le reste de la frise interne est regroupé
// sous « En préparation » pour ne pas exposer la mécanique de production.
export type PublicationDisplayStatus = "Publiée" | "À valider" | "En préparation" | "Erreur de publication" | "Annulée";

export function publicationDisplayStatus(status: PublicationStatus): PublicationDisplayStatus {
  if (status === "published") return "Publiée";
  if (status === "to_validate") return "À valider";
  if (status === "publish_error") return "Erreur de publication";
  if (status === "cancelled") return "Annulée";
  return "En préparation";
}

// ---------------------------------------------------------------------------------------------
// Présences terrain — DATA_MODEL.md ne modélise pas d'entité dédiée (seuls
// Subscription.presencesUsed / Plan.seasonPresences existent, au niveau saison). Cette entité
// locale porte le détail ligne par ligne attendu par ACTIONS.md § 9 /presences.
// ---------------------------------------------------------------------------------------------

export type PresenceKind = "match" | "training" | "shooting" | "event";
export type PresenceStatus = "scheduled" | "completed" | "cancelled";

export const PRESENCE_KIND_LABELS: Record<PresenceKind, string> = {
  match: "Match",
  training: "Entraînement",
  shooting: "Tournage",
  event: "Événement",
};

export interface Presence {
  id: string;
  organizationId: string;
  date: string;
  eventLabel: string;
  kind: PresenceKind;
  /** Opérateur SportVision — affiché seulement si le rôle de l'utilisateur y donne accès. */
  operatorName?: string;
  status: PresenceStatus;
}

// ---------------------------------------------------------------------------------------------
// Analytics — /analytics. DATA_MODEL.md ne modélise les statistiques qu'au niveau de chaque
// Publication (reach, engagement, views). Ce résumé agrège ces chiffres au niveau organisation,
// avec la progression attendue par ACTIONS.md § 9 (« chacune avec sa progression »).
// ---------------------------------------------------------------------------------------------

export interface AnalyticsSummary {
  organizationId: string;
  reach: number;
  reachDeltaPct: number;
  views: number;
  viewsDeltaPct: number;
  engagement: number;
  engagementDeltaPct: number;
  followers: number;
  followersDeltaPct: number;
}

// ---------------------------------------------------------------------------------------------
// Report — rapport mensuel (DATA_MODEL.md § Report). Réservé à Full Communication.
// ---------------------------------------------------------------------------------------------

export type ReportStatus = "draft" | "available" | "read";

export interface ReportPerformance {
  reach: number;
  reachDeltaPct: number;
  engagement: number;
  engagementDeltaPct: number;
  views: number;
  viewsDeltaPct: number;
  followersGained: number;
}

export interface Report {
  id: string;
  organizationId: string;
  /** Format `2026-07`. */
  period: string;
  status: ReportStatus;
  summary: string;
  objectives: string[];
  contentsProduced: { label: string; count: number }[];
  performance: ReportPerformance;
  bestPublicationTitle: string;
  bestPublicationStats: string;
  servicesCompleted: number;
  recommendations: string[];
  nextMonthPlan: string[];
}

// ---------------------------------------------------------------------------------------------
// Thread et Message — DATA_MODEL.md § Thread et Message. Modélisés ici uniquement pour porter
// le fil avec le Community Manager consommé par /mycm. Pas de messagerie générale : chaque fil
// reste rattaché à un objet (ici `communication`).
// ---------------------------------------------------------------------------------------------

export type ThreadContextType = "communication" | "service" | "visual_request" | "billing" | "support" | "general_account";

export interface Thread {
  id: string;
  organizationId: string;
  subject: string;
  contextType: ThreadContextType;
  contextId?: string;
  /** Libellé du rôle SportVision côté fil — jamais un rôle technique interne. */
  sportvisionRoleLabel: string;
  participantNames: string[];
  lastMessageAt: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  threadId: string;
  authorName: string;
  body: string;
  /** Un message internal_only n'apparaît jamais dans Connect — voir DATA_MODEL.md § Thread et Message. */
  visibility: "client_visible" | "internal_only";
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Fiche Community Manager — /mycm. Pas une entité DATA_MODEL à part entière : dérivée de
// Organization.communityManagerId, portée ici comme profil lisible pour l'écran dédié.
// ---------------------------------------------------------------------------------------------

export type CmAvailability = "available" | "filming" | "off";

export interface CommunityManagerProfile {
  id: string;
  name: string;
  role: string;
  avatarInitials: string;
  availability: CmAvailability;
  contentsProducedThisMonth: number;
  responseTime: string;
  nextMeetingAt?: string;
  workingTogether: string[];
}
