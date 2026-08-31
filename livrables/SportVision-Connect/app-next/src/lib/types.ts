// Types fondamentaux — voir ../../../context/import/SportVision-Connect-Design/DATA_MODEL.md
// pour le modèle complet. Les entités propres à un module (VisualRequest, Service, MediaAsset...)
// vivent dans src/lib/types/<module>.ts, pas ici, pour éviter qu'un seul fichier ne devienne un
// point de conflit entre agents travaillant en parallèle.

export type OrgType =
  | "club"
  | "academy"
  | "coach"
  // Structure de coaching (17/08/2026, migration-connect-v78-signup-unifie-
  // clubplus.sql) : "Plusieurs coachs, intervenants ou groupes" — nouveau
  // type réel côté organizations.organization_type='structure_coaching'
  // (mapOrgType, src/lib/supabase/mappers.ts). Aucun dashboard/nav dédié
  // construit pour l'instant (hors périmètre) : resolveNavigation retombe
  // sur NAV_GENERIC comme tout OrgType non explicitement branché.
  | "coaching_structure"
  | "player"
  | "parent"
  | "cm_agency"
  | "sponsor"
  | "tournament_organizer"
  | "camp"
  | "generic";

export type PlanCode =
  | "club_plus_free"
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
  | "sports_director"
  | "admin_staff"
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
  /** `organizations.legacy_client_id` (clients.id) — le VRAI pont vers `contrats`/`client_devis`/
   * `client_factures`/`client_users`, PAS `organization.id` (uuid généré indépendamment côté
   * organisation depuis connect-org-activate). Posé pour "generic" (Espace Projet) et les 4 types
   * Full Communication-éligibles (coach/academie/tournoi/stage) par buildProjetActiveContext /
   * buildOrgSpaceActiveContext (session.ts) — voir leur commentaire du 31/08/2026 pour le bug que
   * ce champ corrige. `undefined` si l'organisation n'a jamais été rattachée à une fiche Portail
   * (état honnête, pas une erreur) — voir useClientId() pour la résolution côté écran. */
  portailClientId?: string;
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
  /** "Mes événements" (Bible §14) — organisateur de tournoi, `organization.type ===
   * "tournament_organizer"`. Distinct de "eventtimeline" (checklist de préparation d'UN
   * événement) : ici, liste + fiche des Éditions (event_editions), au pluriel. */
  | "events"
  /** "Mes sessions" (Bible §15) — organisateur de stage/camp, `organization.type === "camp"`.
   * Distinct de "sessions" (séances individuelles d'un coach indépendant, calendar_events
   * type='seance') : ici, liste + fiche des Sessions (event_sessions). */
  | "campsessions"
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
  | "appointments"
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
  | "event_edition"
  | "event_session"
  | "sponsor"
  | "collection"
  | "user_invitation"
  | "document"
  | "calendar_event"
  | "support_ticket"
  | "message";

export type FeatureKey = string;

export type QuotaKey = "monthly_visuals" | "season_presences" | "storage" | "seats";
