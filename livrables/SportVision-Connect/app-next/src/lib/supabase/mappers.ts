import type { MembershipRole, OrgType, PlanCode } from "@/lib/types";

// Traduction schéma réel (français, 5 types d'organisation, rôles club en dur) vers les types
// du design (anglais, 9 types). Voir le plan Phase 1 § Décisions d'architecture n°1 : cette
// couche est volontairement isolée ici plutôt que de réécrire types.ts, pour ne pas retoucher
// les 63 fichiers qui consomment useSession().

/** organizations.organization_type réel → OrgType du design. */
const ORG_TYPE_MAP: Record<string, OrgType> = {
  club: "club",
  academie: "academy",
  coach: "coach",
  projet: "generic",
  sponsor: "sponsor",
  tournoi: "tournament_organizer",
  stage: "camp",
  cm_agency: "cm_agency",
};

export function mapOrgType(realType: string): OrgType {
  return ORG_TYPE_MAP[realType] ?? "generic";
}

/** club_members.role réel (check constraint) → MembershipRole du design.
 * directeur_sportif/administratif (migration-clubplus-v40, NON EXÉCUTÉE) : les 2 rôles
 * manquants de la Product Bible §8/§10 — voir permissions.ts pour leurs règles d'accès et
 * navigation.ts pour leur navigation dédiée. */
const CLUB_ROLE_MAP: Record<string, MembershipRole> = {
  admin: "admin",
  president: "president",
  secretaire: "secretary",
  comm: "communication_manager",
  cm_externe: "external_cm",
  coach: "coach",
  resp_equipe: "team_manager",
  directeur_sportif: "sports_director",
  administratif: "admin_staff",
  sponsor_mgr: "sponsor_manager",
  tresorier: "treasurer",
  membre_bureau: "board_member",
  lecture_seule: "viewer",
};

export function mapClubRole(realRole: string): MembershipRole {
  return CLUB_ROLE_MAP[realRole] ?? "viewer";
}

const CLUB_ROLE_REVERSE_MAP: Partial<Record<MembershipRole, string>> = Object.fromEntries(
  Object.entries(CLUB_ROLE_MAP).map(([real, design]) => [design, real]),
);

/** MembershipRole du design → club_members.role réel (check constraint), pour l'invitation. */
export function mapClubRoleToReal(role: MembershipRole): string {
  return CLUB_ROLE_REVERSE_MAP[role] ?? "lecture_seule";
}

/**
 * memberships.role réel pour un espace projet : toujours 'client' (posé par
 * sync_client_user_to_membership, migration-connect-v7 — un seul rôle réel, pas de finesse).
 * Mappé sur "admin" : le client est responsable de son propre espace, jamais en lecture seule.
 */
export function mapProjetRole(_realRole: string): MembershipRole {
  return "admin";
}

/**
 * organization_role_catalog réel (migration-connect-v6.sql) → MembershipRole du design, par
 * type d'organisation. Coach/académie/sponsor n'ont pas de plan/quota vendu (pas
 * d'organization_entitlements) — voir le plan Phase 4.
 */
const COACH_ROLE_MAP: Record<string, MembershipRole> = {
  proprietaire: "owner",
  assistant: "staff",
  resp_communication: "communication_manager",
  collaborateur_limite: "viewer",
};

const ACADEMIE_ROLE_MAP: Record<string, MembershipRole> = {
  admin: "admin",
  secretaire: "secretary",
  coach: "coach",
  resp_programme: "manager",
  resp_communication: "communication_manager",
  lecture_seule: "viewer",
};

const SPONSOR_ROLE_MAP: Record<string, MembershipRole> = {
  referent: "sponsor_manager",
  contact: "viewer",
};

// tournoi/stage/cm_agency (migration-connect-v20 puis migration-clubplus-v44, bascule 2 org
// types séparés) : catalogue minimaliste 2 rôles chacun, comme sponsor à sa création — voir
// mapping ADMIN_ROLE_BY_TYPE côté connect-org-activate pour la contrepartie serveur. Même
// catalogue de rôles réels (responsable/partenaire) pour tournoi et stage — voir migration-
// clubplus-v44, section 3.
const TOURNAMENT_CAMP_ROLE_MAP: Record<string, MembershipRole> = {
  responsable: "event_admin",
  partenaire: "partner",
};

const CM_AGENCY_ROLE_MAP: Record<string, MembershipRole> = {
  proprietaire: "owner",
  collaborateur: "staff",
};

export function mapOrgRole(
  orgType: "coach" | "academie" | "sponsor" | "tournoi" | "stage" | "cm_agency",
  realRole: string,
): MembershipRole {
  if (orgType === "coach") return COACH_ROLE_MAP[realRole] ?? "viewer";
  if (orgType === "academie") return ACADEMIE_ROLE_MAP[realRole] ?? "viewer";
  if (orgType === "tournoi" || orgType === "stage") return TOURNAMENT_CAMP_ROLE_MAP[realRole] ?? "viewer";
  if (orgType === "cm_agency") return CM_AGENCY_ROLE_MAP[realRole] ?? "viewer";
  return SPONSOR_ROLE_MAP[realRole] ?? "viewer";
}

/**
 * clubs.plan réel ('club'|'performance') → PlanCode du design. Sert uniquement à faire
 * fonctionner resolveNavigation()/PLANS[...] sans les modifier — jamais la source de vérité
 * pour savoir si un module est activé (ça, c'est organization_entitlements, voir entitlements.ts).
 */
const CLUB_PLAN_MAP: Record<string, PlanCode> = {
  club: "club_plus_start",
  performance: "club_plus_performance",
};

export function mapClubPlan(realPlan: string): PlanCode {
  return CLUB_PLAN_MAP[realPlan] ?? "club_plus_start";
}

/** Libellés d'affichage du sélecteur d'espace, par organization_type réel ou par kind personnel. */
export const SPACE_TYPE_LABELS: Record<string, string> = {
  club: "Club",
  academie: "Académie",
  coach: "Coach",
  projet: "Projet / Prestation",
  sponsor: "Sponsor / Partenaire",
  player: "Joueur",
  parent: "Parent / Famille",
  tournoi: "Tournoi / Événement",
  stage: "Stage / Camp",
  cm_agency: "Agence CM",
};
