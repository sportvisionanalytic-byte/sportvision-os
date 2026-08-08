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
};

export function mapOrgType(realType: string): OrgType {
  return ORG_TYPE_MAP[realType] ?? "generic";
}

/** club_members.role réel (check constraint) → MembershipRole du design. */
const CLUB_ROLE_MAP: Record<string, MembershipRole> = {
  admin: "admin",
  president: "president",
  secretaire: "secretary",
  comm: "communication_manager",
  cm_externe: "external_cm",
  coach: "coach",
  resp_equipe: "team_manager",
  sponsor_mgr: "sponsor_manager",
  tresorier: "treasurer",
  membre_bureau: "board_member",
  lecture_seule: "viewer",
};

export function mapClubRole(realRole: string): MembershipRole {
  return CLUB_ROLE_MAP[realRole] ?? "viewer";
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
};
