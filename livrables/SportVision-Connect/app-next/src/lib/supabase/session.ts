import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import type { ActiveContext } from "@/lib/types";
import { mapClubPlan, mapClubRole, mapOrgType, SPACE_TYPE_LABELS } from "./mappers";

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
  /** Seuls les espaces organisation de type club sont branchés en Phase 1. */
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
      clickable: orgType === "club",
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
      clickable: false,
    });
  }

  for (const row of (parentRes.data ?? []) as { id: string; prenom: string; nom: string }[]) {
    spaces.push({
      kind: "parent",
      id: row.id,
      name: `${row.prenom} ${row.nom}`,
      subtitle: SPACE_TYPE_LABELS.parent ?? "Parent / Famille",
      clickable: false,
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
      .select("id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved")
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

  const meta = (authUser.user_metadata ?? {}) as { prenom?: string; nom?: string; telephone?: string };

  const entitlements: NonNullable<ActiveContext["entitlements"]> = {};
  for (const row of (entitlementsRes.data ?? []) as EntitlementRow[]) {
    entitlements[row.module_key] = {
      actif: row.actif,
      quotaCredits: row.quota_credits,
      priorite: row.priorite === "prioritaire" ? "prioritaire" : "standard",
    };
  }

  return {
    user: {
      id: authUser.id,
      firstName: meta.prenom ?? "",
      lastName: meta.nom ?? "",
      email: authUser.email ?? "",
      phone: meta.telephone,
      locale: "fr",
      theme: "dark",
      mfaEnabled: false,
      onboardingStep: 10,
      onboardingCompletedAt: authUser.created_at,
    },
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
      planCode: mapClubPlan(club.plan),
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
