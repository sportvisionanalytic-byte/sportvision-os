// Types fondamentaux — voir ../../../context/import/SportVision-Connect-Design/DATA_MODEL.md
// pour le modèle complet. Les entités propres à un module (VisualRequest, Service, MediaAsset...)
// vivent dans src/lib/types/<module>.ts, pas ici, pour éviter qu'un seul fichier ne devienne un
// point de conflit entre agents travaillant en parallèle.

export type OrgType =
  | "club"
  | "academy"
  | "coach"
  | "player"
  | "parent"
  | "cm_agency"
  | "sponsor"
  | "event"
  | "generic";

export type PlanCode =
  | "essentiel"
  | "club_plus_start"
  | "club_plus_performance"
  | "full_communication"
  | "club_access"
  | "one_off";

export type MembershipRole =
  // Club
  | "owner"
  | "admin"
  | "president"
  | "communication_manager"
  | "secretary"
  | "coach"
  | "team_manager"
  | "sponsor_manager"
  | "treasurer"
  | "board_member"
  | "player"
  | "parent"
  | "viewer"
  | "external_cm"
  // Académie
  | "manager"
  | "internal_cm"
  | "staff"
  // Événement
  | "event_admin"
  | "partner_manager"
  | "volunteer"
  | "partner";

export interface Organization {
  id: string;
  type: OrgType;
  name: string;
  logoUrl?: string;
  address?: string;
  siret?: string;
  legalName?: string;
  brandColors?: string[];
  instagramHandle?: string;
  tiktokHandle?: string;
  teamCount?: number;
  memberCount?: number;
  /** Renseigné pour un joueur affilié à un club abonné — voir DATA_MODEL.md § Organization. */
  parentOrganizationId?: string;
  accountManagerId?: string;
  communityManagerId?: string;
  createdAt: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  jobTitle?: string;
  locale: "fr" | "en";
  theme: "dark" | "light";
  mfaEnabled: boolean;
  onboardingStep: number;
  onboardingCompletedAt?: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  /** Vide = toutes les équipes. */
  teamScope: string[];
  capabilities: string[];
  status: "active" | "invited" | "disabled";
}

export interface Subscription {
  id: string;
  organizationId: string;
  planCode: PlanCode;
  status: "active" | "past_due" | "suspended" | "cancelled";
  startsAt: string;
  renewsAt: string;
  commitmentMonths: number;
  noticeMonths: number;
  creditsRemaining: number;
  creditsReserved: number;
  presencesUsed: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
}

/** Session résolue : l'organisation active + le rôle de l'utilisateur dedans + son abonnement. */
export interface ActiveContext {
  user: User;
  organization: Organization;
  membership: Membership;
  subscription: Subscription;
  /**
   * organization_entitlements réels, clé = connect_modules.key. Absent en mock (Phase 0) ;
   * alimenté par src/lib/supabase/session.ts pour un contexte club réel (Phase 1) — voir
   * permissions.ts § canAccess.
   */
  entitlements?: Record<string, { actif: boolean; quotaCredits: number | null; priorite: "standard" | "prioritaire" }>;
}

export type ModuleKey =
  | "dashboard"
  | "studio"
  | "newsroom"
  | "matchcenter"
  | "communication"
  | "validations"
  | "publications"
  | "presences"
  | "analytics"
  | "reports"
  | "mycm"
  | "visual_requests"
  | "services"
  | "sessions"
  | "camps"
  | "eventtimeline"
  | "live"
  | "content"
  | "teams"
  | "calendar"
  | "sponsors"
  | "contracts"
  | "billing"
  | "users"
  | "children"
  | "authorizations"
  | "documents"
  | "messages"
  | "accompagnement"
  | "support"
  | "settings";

export type ResourceKey =
  | "visual_request"
  | "service_request"
  | "publication"
  | "newsroom_item"
  | "match_result"
  | "team"
  | "player"
  | "camp"
  | "sponsor"
  | "collection"
  | "user_invitation"
  | "document"
  | "calendar_event"
  | "support_ticket"
  | "message";

export type FeatureKey = string;

export type QuotaKey = "monthly_visuals" | "season_presences" | "storage" | "seats";
