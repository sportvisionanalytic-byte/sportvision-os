import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import type { ActiveContext, User } from "@/lib/types";
import { mapClubPlan, mapClubRole, mapOrgRole, mapOrgType, mapProjetRole, SPACE_TYPE_LABELS } from "./mappers";

function buildUserFromAuth(authUser: SupabaseUser): User {
  const meta = (authUser.user_metadata ?? {}) as { prenom?: string; nom?: string; telephone?: string; locale?: "fr" | "en" };
  return {
    id: authUser.id,
    firstName: meta.prenom ?? "",
    lastName: meta.nom ?? "",
    email: authUser.email ?? "",
    phone: meta.telephone,
    locale: meta.locale ?? "fr",
    theme: "dark",
    mfaEnabled: false,
    onboardingStep: 10,
    onboardingCompletedAt: authUser.created_at,
  };
}

// Reproduit bootAfterLogin() de l'app vanilla (app/index.html ~820-869) : un "espace" n'est pas
// forcément une organisation — un espace Joueur/Famille n'a pas de ligne `memberships`, juste une
// ligne `player_profiles`/`parent_profiles` propre (voir le commentaire original, index.html
// ~802-806). Voir le plan Phase 1 § Décisions d'architecture n°2 et n°3.

export const ACTIVE_SPACE_COOKIE = "sv_active_space";

export interface Space {
  kind: "organization" | "player" | "parent";
  /** organization_id pour kind="organization" ; player_profiles.id / parent_profiles.id sinon. */
  id: string;
  name: string;
  subtitle: string;
  /** false uniquement pour une organisation non-club (coach/académie/sponsor/projet réels) —
   * bascule espace par espace, voir le plan Phase 1 § Décisions d'architecture n°3. Club, joueur
   * et parent sont cliquables depuis la Phase 2. */
  clickable: boolean;
  organizationType?: string;
  membershipId?: string;
  role?: string;
  status?: string;
}

export function spaceKey(space: Pick<Space, "kind" | "id">): string {
  return `${space.kind}:${space.id}`;
}

interface MembershipRow {
  id: string;
  organization_id: string;
  role: string;
  status: string;
  organizations: { id: string; nom: string; organization_type: string; statut: string } | null;
}

export async function getSpaces(supabase: SupabaseClient, userId: string): Promise<Space[]> {
  const [orgRes, playerRes, parentRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, organization_id, role, status, organizations(id, nom, organization_type, statut)")
      .eq("user_id", userId)
      .eq("status", "actif"),
    supabase.from("player_profiles").select("id, prenom, nom, account_status").eq("user_id", userId),
    supabase.from("parent_profiles").select("id, prenom, nom").eq("user_id", userId),
  ]);

  const spaces: Space[] = [];

  for (const row of (orgRes.data ?? []) as unknown as MembershipRow[]) {
    if (!row.organizations) continue;
    const orgType = row.organizations.organization_type;
    spaces.push({
      kind: "organization",
      id: row.organizations.id,
      name: row.organizations.nom,
      subtitle: SPACE_TYPE_LABELS[orgType] ?? orgType,
      clickable: orgType === "club" || orgType === "projet" || orgType === "coach" || orgType === "academie" || orgType === "sponsor",
      organizationType: orgType,
      membershipId: row.id,
      role: row.role,
      status: row.status,
    });
  }

  for (const row of (playerRes.data ?? []) as { id: string; prenom: string; nom: string }[]) {
    spaces.push({
      kind: "player",
      id: row.id,
      name: `${row.prenom} ${row.nom}`,
      subtitle: SPACE_TYPE_LABELS.player ?? "Joueur",
      clickable: true,
    });
  }

  for (const row of (parentRes.data ?? []) as { id: string; prenom: string; nom: string }[]) {
    spaces.push({
      kind: "parent",
      id: row.id,
      name: `${row.prenom} ${row.nom}`,
      subtitle: SPACE_TYPE_LABELS.parent ?? "Parent / Famille",
      clickable: true,
    });
  }

  return spaces;
}

/** Précédence identique à openSpace()/bootAfterLogin() : dernier espace cliquable mémorisé,
 * sinon auto-sélection si un seul espace cliquable, sinon aucun (écran sélecteur). */
export function pickActiveSpace(spaces: Space[], rememberedKey: string | undefined): Space | null {
  const clickable = spaces.filter((s) => s.clickable);
  if (rememberedKey) {
    const remembered = clickable.find((s) => spaceKey(s) === rememberedKey);
    if (remembered) return remembered;
  }
  if (clickable.length === 1) return clickable[0]!;
  return null;
}

interface ClubRow {
  id: string;
  ville: string | null;
  discipline: string | null;
  plan: string;
  engagement: string;
  credits_balance: number;
  credits_monthly: number;
  credits_reserved: number;
  portail_client_id: string | null;
}

interface EntitlementRow {
  module_key: string;
  actif: boolean;
  quota_credits: number | null;
  priorite: string;
}

/** Construit l'ActiveContext complet pour un espace organisation de type club. */
export async function buildClubActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || !space.clickable) return null;

  const [orgRes, clubRes, entitlementsRes] = await Promise.all([
    supabase.from("organizations").select("id, nom, organization_type, created_at").eq("id", space.id).maybeSingle(),
    supabase
      .from("clubs")
      .select("id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved, portail_client_id")
      .eq("id", space.id)
      .maybeSingle(),
    supabase
      .from("organization_entitlements")
      .select("module_key, actif, quota_credits, priorite")
      .eq("organization_id", space.id),
  ]);

  const org = orgRes.data as { id: string; nom: string; organization_type: string; created_at: string } | null;
  const club = clubRes.data as ClubRow | null;
  if (!org || !club || !space.role) return null;

  // Un club réel n'a jamais organization_entitlements/clubs.plan pour distinguer "Full
  // Communication" de Club+ : ce plan est vendu par contrat, pas par abonnement logiciel. Dérivé
  // d'un contrat réel actif (contrats.type_contrat='full_communication', migration-contrats-v2)
  // lié au client Portail relié au club — jamais d'un nouveau champ sur `clubs`. Un club sans
  // portail_client_id (jamais relié) ou sans contrat actif de ce type retombe sur club/performance
  // via mapClubPlan, comportement inchangé.
  let isFullCommunication = false;
  if (club.portail_client_id) {
    const { data: contract } = await supabase
      .from("contrats")
      .select("id")
      .eq("client_id", club.portail_client_id)
      .eq("type_contrat", "full_communication")
      .eq("statut", "actif")
      .limit(1)
      .maybeSingle();
    isFullCommunication = Boolean(contract);
  }

  const entitlements: NonNullable<ActiveContext["entitlements"]> = {};
  for (const row of (entitlementsRes.data ?? []) as EntitlementRow[]) {
    entitlements[row.module_key] = {
      actif: row.actif,
      quotaCredits: row.quota_credits,
      priorite: row.priorite === "prioritaire" ? "prioritaire" : "standard",
    };
  }

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: mapOrgType(org.organization_type),
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: space.membershipId!,
      userId: authUser.id,
      organizationId: org.id,
      role: mapClubRole(space.role),
      teamScope: [],
      capabilities: [],
      status: space.status === "actif" ? "active" : space.status === "invitation" ? "invited" : "disabled",
    },
    subscription: {
      id: `sub-${club.id}`,
      organizationId: org.id,
      planCode: isFullCommunication ? "full_communication" : mapClubPlan(club.plan),
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: club.engagement === "12mois" ? 12 : 0,
      noticeMonths: 0,
      creditsRemaining: Math.max(0, club.credits_balance - club.credits_reserved),
      creditsReserved: club.credits_reserved,
      // Non trackés côté réel pour l'instant — voir le plan Phase 1 § permissions.ts.
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
    entitlements,
  };
}

interface PlayerProfileRow {
  id: string;
  club_id: string;
  prenom: string;
  nom: string;
  account_status: string;
  created_at: string;
}

/**
 * Construit l'ActiveContext pour un espace Joueur — voir le plan Phase 2 § Décisions
 * d'architecture n°1. `membership`/`subscription` sont synthétiques (un joueur n'a ni ligne
 * `memberships` ni `clubs` propre) : role "player", plan "club_access" (déjà la convention posée
 * par le mock pour "inclus dans l'offre du club"), quotas à 0 (non trackés côté réel).
 * `entitlements` reste undefined — canAccess() verrouille alors tout module gated par une clé
 * (teams, matchcenter, sponsors...), ce qui est le comportement voulu pour un espace personnel.
 */
export async function buildPlayerActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "player") return null;

  const { data } = await supabase
    .from("player_profiles")
    .select("id, club_id, prenom, nom, account_status, created_at")
    .eq("id", space.id)
    .maybeSingle();
  const player = data as PlayerProfileRow | null;
  if (!player) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: player.id,
      type: "player",
      name: `${player.prenom} ${player.nom}`,
      // Toujours résolvable : player_profiles.club_id est NOT NULL en base (un joueur appartient
      // toujours à un seul club) — voir le plan Phase 2 § Décisions d'architecture n°1.
      parentOrganizationId: player.club_id,
      createdAt: player.created_at,
    },
    membership: {
      id: `player-membership-${player.id}`,
      userId: authUser.id,
      organizationId: player.id,
      role: "player",
      teamScope: [],
      capabilities: [],
      status: player.account_status === "actif" ? "active" : "disabled",
    },
    subscription: {
      id: `sub-${player.id}`,
      organizationId: player.id,
      planCode: "club_access",
      status: "active",
      startsAt: player.created_at,
      renewsAt: player.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

interface ParentProfileRow {
  id: string;
  prenom: string | null;
  nom: string | null;
  created_at: string;
}

/**
 * Construit l'ActiveContext pour un espace Famille. `organization.parentOrganizationId` reste
 * undefined (contrairement au joueur) : un parent peut avoir des enfants dans plusieurs clubs,
 * pas de club unique à résoudre sans ambiguïté — voir le plan Phase 2 § Décisions
 * d'architecture n°1. `membership.status` = "active" si au moins un enfant confirmé
 * (`parent_player_relationships.statut='confirme'`), sinon "invited" (en attente).
 */
export async function buildParentActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "parent") return null;

  const [parentRes, confirmedRes] = await Promise.all([
    supabase.from("parent_profiles").select("id, prenom, nom, created_at").eq("id", space.id).maybeSingle(),
    supabase
      .from("parent_player_relationships")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", space.id)
      .eq("statut", "confirme"),
  ]);
  const parent = parentRes.data as ParentProfileRow | null;
  if (!parent) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: parent.id,
      type: "parent",
      name: `${parent.prenom ?? ""} ${parent.nom ?? ""}`.trim() || (authUser.email ?? "Parent"),
      createdAt: parent.created_at,
    },
    membership: {
      id: `parent-membership-${parent.id}`,
      userId: authUser.id,
      organizationId: parent.id,
      role: "parent",
      teamScope: [],
      capabilities: [],
      status: (confirmedRes.count ?? 0) > 0 ? "active" : "invited",
    },
    subscription: {
      id: `sub-${parent.id}`,
      organizationId: parent.id,
      planCode: "club_access",
      status: "active",
      startsAt: parent.created_at,
      renewsAt: parent.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

/**
 * Construit l'ActiveContext pour un espace Projet (organizations.organization_type='projet',
 * client ponctuel indépendant — ex-Portail). Contrairement à joueur/parent, une vraie ligne
 * `memberships` existe (role réel toujours 'client', posé par sync_client_user_to_membership) —
 * voir le plan Phase 3 § Décisions d'architecture n°1. Pas de `clubs`/`organization_entitlements` :
 * planCode "one_off" ("Facturé à la commande"), entitlements undefined (aucun module Projet n'est
 * gated par une clé connect_modules de toute façon).
 */
export async function buildProjetActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || space.organizationType !== "projet" || !space.clickable) return null;

  const { data } = await supabase
    .from("organizations")
    .select("id, nom, organization_type, created_at")
    .eq("id", space.id)
    .maybeSingle();
  const org = data as { id: string; nom: string; organization_type: string; created_at: string } | null;
  if (!org || !space.role) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: mapOrgType(org.organization_type),
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: space.membershipId!,
      userId: authUser.id,
      organizationId: org.id,
      role: mapProjetRole(space.role),
      teamScope: [],
      capabilities: [],
      status: space.status === "actif" ? "active" : space.status === "invitation" ? "invited" : "disabled",
    },
    subscription: {
      id: `sub-${org.id}`,
      organizationId: org.id,
      planCode: "one_off",
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

// event/cm_agency (migration-connect-v20) ajoutés le 10/08 : même socle réel exact que
// coach/académie/sponsor (memberships + organization_role_catalog, pas d'entitlements) —
// seule différence, leur création passe par connect-staff-create-org/connect-org-activate
// (staff) plutôt que connect-org-signup (self-service), ce qui ne change rien ici : cette
// fonction lit uniquement l'état déjà en base, peu importe comment il y est arrivé.
const GENERIC_ORG_TYPES = ["coach", "academie", "sponsor", "event", "cm_agency"] as const;
type GenericOrgType = (typeof GENERIC_ORG_TYPES)[number];

/**
 * Construit l'ActiveContext pour un espace Coach, Académie, Sponsor, Événement ou Agence CM.
 * Les 5 partagent le même socle réel (migration-connect-v3/v4/v6/v20) : une vraie ligne
 * `memberships`, un rôle réel via `organization_role_catalog` (pas de check constraint en dur
 * comme pour club_members), et aucune `organization_entitlements` (pas de plan/quota vendu —
 * planCode "one_off", comme pour un espace projet). Une seule fonction paramétrée plutôt que 5
 * quasi-identiques : les 5 backends sont structurellement identiques, seul le rôle diffère.
 */
export async function buildOrgSpaceActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || !space.clickable) return null;
  if (!GENERIC_ORG_TYPES.includes(space.organizationType as GenericOrgType)) return null;
  const orgType = space.organizationType as GenericOrgType;

  const { data } = await supabase
    .from("organizations")
    .select("id, nom, organization_type, created_at")
    .eq("id", space.id)
    .maybeSingle();
  const org = data as { id: string; nom: string; organization_type: string; created_at: string } | null;
  if (!org || !space.role) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: mapOrgType(org.organization_type),
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: space.membershipId!,
      userId: authUser.id,
      organizationId: org.id,
      role: mapOrgRole(orgType, space.role),
      teamScope: [],
      capabilities: [],
      status: space.status === "actif" ? "active" : space.status === "invitation" ? "invited" : "disabled",
    },
    subscription: {
      id: `sub-${org.id}`,
      organizationId: org.id,
      planCode: "one_off",
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}
