// Types propres aux modules Paramètres, Support, Notifications, Documents et Utilisateurs.
// Voir ../../../../context/import/SportVision-Connect-Design/DATA_MODEL.md pour le modèle
// source. Fichier dédié pour ne jamais entrer en conflit avec un autre agent qui travaille en
// parallèle sur un autre module (voir README.md § Conventions pour construire un nouveau module).

import type { MembershipRole } from "@/lib/types";

// --- Intégrations (DATA_MODEL.md § Integration) -----------------------------------------------

export type IntegrationProvider =
  | "google_calendar"
  | "instagram"
  | "tiktok"
  | "meta_business"
  | "whatsapp"
  | "stripe";

export type IntegrationStatus = "connected" | "disconnected" | "error";

export interface IntegrationScope {
  label: string;
  granted: boolean;
}

export interface IntegrationSyncLogEntry {
  id: string;
  label: string;
  occurredAt: string;
  success: boolean;
}

export interface Integration {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  name: string;
  description: string;
  status: IntegrationStatus;
  accountLabel?: string;
  scopes: IntegrationScope[];
  lastSyncedAt?: string;
  calendarMapping?: { source: string; target: string }[];
  syncLog: IntegrationSyncLogEntry[];
}

// --- Utilisateurs (DATA_MODEL.md § Membership) -------------------------------------------------

export interface OrgUser {
  id: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string;
  role: MembershipRole;
  teamScope: string[];
  status: "active" | "invited" | "disabled";
  lastSeenAt?: string;
  invitedAt?: string;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  president: "Président",
  communication_manager: "Responsable communication",
  secretary: "Secrétaire",
  coach: "Coach",
  team_manager: "Responsable d'équipe",
  sponsor_manager: "Responsable sponsors",
  treasurer: "Trésorier",
  board_member: "Membre du bureau",
  player: "Joueur",
  parent: "Parent",
  viewer: "Lecture seule",
  external_cm: "Community manager externe",
  manager: "Responsable",
  internal_cm: "Community manager",
  staff: "Staff",
  event_admin: "Administrateur événement",
  partner_manager: "Responsable partenaires",
  volunteer: "Bénévole",
  partner: "Partenaire",
};

// --- Support (DATA_MODEL.md § SupportTicket) ----------------------------------------------------

export type SupportTicketCategory =
  | "content"
  | "billing"
  | "technical"
  | "contract"
  | "account"
  | "other";

export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

// "waiting_client" = SportVision attend une réponse du client (jamais produit par
// club_support_tickets.status aujourd'hui, aucune écriture réelle ne le pose). "response_available"
// (ajouté 16/08, migration-clubplus-v39.sql § club_support_tickets_status_check) est l'INVERSE :
// SportVision a répondu, une réponse est disponible et attend une lecture côté client — Bible
// §21 "Ticket support : Envoyée / En cours / Réponse disponible / Résolue / Fermée". Les deux
// notions sont distinctes et ne doivent jamais être confondues sous un même statut.
export type SupportTicketStatus =
  | "open"
  | "in_progress"
  | "waiting_client"
  | "response_available"
  | "resolved"
  | "closed";

export interface SupportTicket {
  id: string;
  reference: string;
  organizationId: string;
  createdById: string;
  subject: string;
  category: SupportTicketCategory;
  module?: string;
  priority: SupportTicketPriority;
  description: string;
  status: SupportTicketStatus;
  assigneeName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTopic {
  id: string;
  title: string;
  description: string;
  articleCount: number;
}

// --- Documents (DATA_MODEL.md § Document) --------------------------------------------------------

export type DocumentKind =
  | "quote"
  | "contract"
  | "invoice"
  | "image_right"
  | "brand_guidelines"
  | "logo_pack"
  | "insurance"
  | "medical"
  | "roster"
  | "report"
  | "other";

export type DocumentStatus = "to_review" | "to_sign" | "to_complete" | "valid" | "expired";

export interface AppDocument {
  id: string;
  organizationId: string;
  name: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: string;
  teamName?: string;
  playerName?: string;
  status: DocumentStatus;
  completionRatio?: number;
  expiresAt?: string;
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  quote: "Devis",
  contract: "Contrat",
  invoice: "Facture",
  image_right: "Droit à l'image",
  brand_guidelines: "Charte graphique",
  logo_pack: "Pack logo",
  insurance: "Assurance",
  medical: "Certificat médical",
  roster: "Effectif",
  report: "Rapport",
  other: "Autre",
};

// --- Notifications (DATA_MODEL.md § Notification) ------------------------------------------------

export type NotificationCategory =
  | "content"
  | "services"
  | "contracts"
  | "payments"
  | "requests"
  | "users"
  | "calendar"
  | "system";

export interface AppNotification {
  id: string;
  userId: string;
  organizationId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  targetHref?: string;
  isPinned: boolean;
  isCritical: boolean;
  readAt?: string;
  createdAt: string;
}

export type NotificationFrequency = "immediate" | "daily_digest" | "weekly_digest" | "monthly" | "never";

export interface NotificationCategoryPreference {
  email: boolean;
  inApp: boolean;
  frequency: NotificationFrequency;
}

export interface NotificationPreferences {
  content: NotificationCategoryPreference;
  services: NotificationCategoryPreference;
  contracts: NotificationCategoryPreference;
  payments: NotificationCategoryPreference;
  requests: NotificationCategoryPreference;
  users: NotificationCategoryPreference;
  calendar: NotificationCategoryPreference;
  system: NotificationCategoryPreference;
  quietHours: {
    notBefore: string;
    notAfter: string;
    sundayUrgentOnly: boolean;
  };
}

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  content: "Contenus",
  services: "Prestations",
  contracts: "Contrats",
  payments: "Paiements",
  requests: "Demandes",
  users: "Utilisateurs",
  calendar: "Calendrier",
  system: "Système",
};

// --- Module verrouillé (ACTIONS.md § 26) ----------------------------------------------------------

// Rien à modéliser ici : voir src/components/access/LockedModule.tsx.
