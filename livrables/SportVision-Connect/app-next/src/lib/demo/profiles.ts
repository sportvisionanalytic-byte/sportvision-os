import type { ActiveContext, MembershipRole, ModuleKey, OrgType, PlanCode } from "@/lib/types";
import { filterClubRoleNav, resolveNavigation, type NavEntry } from "@/lib/navigation";

// Démo publique Club+ (interne, sans login, données factices) — voir README.md § Les treize
// expériences / navigation.ts pour le détail des combinaisons (type d'organisation, offre, rôle)
// qui déterminent la navigation. Demandé par Fouka le 19/08 pour auditer Club+ comme la démo déjà
// livrée pour Connect (app-connect/src/app/demo). AUCUNE de ces valeurs n'est réelle.
//
// Contrairement à Connect (où les pages écran sont peu couplées à Supabase), la majorité des
// pages Club+ font leur propre lecture Supabase en plus de useSession() (voir l'exploration menée
// avant ce fichier) — les composants réels ne sont donc PAS rejouables tels quels avec une session
// fictive. Choix retenu : réutiliser telles quelles les fonctions PURES et déjà exportées de ce
// dépôt (resolveNavigation/filterClubRoleNav/canAccess) contre un ActiveContext entièrement
// fabriqué, pour que la navigation et les cadenas affichés en démo soient un miroir fidèle des
// vraies règles produit — jamais une réimplémentation parallèle qui pourrait diverger. Le contenu
// de chaque écran, lui, est statique (src/lib/demo/content.ts), à l'image de ce qu'a fait Connect.

export interface DemoProfile {
  key: string;
  label: string;
  group: string;
  ctx: ActiveContext;
  nav: NavEntry[];
}

const NOW = "2026-08-19T09:00:00.000Z";

function makeCtx(opts: {
  orgId: string;
  orgType: OrgType;
  orgName: string;
  planCode: PlanCode;
  role: MembershipRole;
  teamScope?: string[];
  jobTitle?: string;
  fullEntitlements?: boolean;
  firstName?: string;
  lastName?: string;
}): ActiveContext {
  const entitlements: ActiveContext["entitlements"] =
    opts.orgType === "club"
      ? {
          equipes: { actif: true, quotaCredits: null, priorite: "standard" },
          match_center: { actif: true, quotaCredits: null, priorite: "standard" },
          newsroom: { actif: true, quotaCredits: null, priorite: "standard" },
          demandes_visuels: { actif: true, quotaCredits: null, priorite: "prioritaire" },
          bibliotheque_contenus: { actif: true, quotaCredits: null, priorite: "standard" },
          sponsors: { actif: true, quotaCredits: null, priorite: "standard" },
          presences: { actif: opts.fullEntitlements ?? false, quotaCredits: null, priorite: "standard" },
        }
      : undefined;

  return {
    user: {
      id: "demo-user",
      firstName: opts.firstName ?? "Camille",
      lastName: opts.lastName ?? "Bernard",
      email: `${(opts.firstName ?? "camille").toLowerCase()}.${(opts.lastName ?? "bernard").toLowerCase()}@exemple.fr`,
      jobTitle: opts.jobTitle,
      locale: "fr",
      theme: "dark",
      mfaEnabled: false,
      onboardingStep: 99,
      onboardingCompletedAt: NOW,
    },
    organization: {
      id: opts.orgId,
      type: opts.orgType,
      name: opts.orgName,
      teamCount: 6,
      memberCount: 84,
      createdAt: "2024-08-01T00:00:00.000Z",
    },
    membership: {
      id: "demo-membership",
      userId: "demo-user",
      organizationId: opts.orgId,
      role: opts.role,
      teamScope: opts.teamScope ?? [],
      capabilities: [],
      status: "active",
    },
    subscription: {
      id: "demo-subscription",
      organizationId: opts.orgId,
      planCode: opts.planCode,
      status: "active",
      startsAt: "2025-09-01T00:00:00.000Z",
      renewsAt: "2026-09-01T00:00:00.000Z",
      commitmentMonths: 12,
      noticeMonths: 1,
      creditsRemaining: 27,
      creditsReserved: 3,
      presencesUsed: 2,
      storageUsedBytes: 18_400_000_000,
      storageQuotaBytes: 50_000_000_000,
    },
    entitlements,
  };
}

function navFor(ctx: ActiveContext): NavEntry[] {
  let entries = resolveNavigation(ctx.organization.type, ctx.subscription.planCode);
  if (ctx.organization.type === "club") entries = filterClubRoleNav(entries, ctx.membership.role, ctx.membership.teamScope);
  return entries;
}

function profile(key: string, label: string, group: string, ctx: ActiveContext): DemoProfile {
  return { key, label, group, ctx, nav: navFor(ctx) };
}

const CLUB = { orgId: "demo-club", orgName: "FC Fontainebleau" } as const;

export const DEMO_PROFILES: DemoProfile[] = [
  profile(
    "club-plus",
    "Club — Club+ Performance (Admin)",
    "Club — offre",
    makeCtx({ ...CLUB, orgType: "club", planCode: "club_plus_performance", role: "admin", jobTitle: "Président", fullEntitlements: false }),
  ),
  profile(
    "club-fullcom",
    "Club — Full Communication (Admin)",
    "Club — offre",
    makeCtx({ ...CLUB, orgType: "club", planCode: "full_communication", role: "admin", jobTitle: "Président", fullEntitlements: true }),
  ),
  profile(
    "club-coach",
    "Club — Coach (Éducateur)",
    "Club — rôle",
    makeCtx({ ...CLUB, orgType: "club", planCode: "club_plus_performance", role: "coach", teamScope: ["U17"], jobTitle: "Éducateur U17", fullEntitlements: false }),
  ),
  profile(
    "club-directeur-sportif",
    "Club — Directeur sportif",
    "Club — rôle",
    makeCtx({ ...CLUB, orgType: "club", planCode: "club_plus_performance", role: "sports_director", jobTitle: "Directeur sportif", fullEntitlements: false }),
  ),
  profile(
    "club-communication",
    "Club — Communication (CM interne)",
    "Club — rôle",
    makeCtx({ ...CLUB, orgType: "club", planCode: "full_communication", role: "communication_manager", jobTitle: "Responsable communication", fullEntitlements: true }),
  ),
  profile(
    "club-secretaire",
    "Club — Secrétaire",
    "Club — rôle",
    makeCtx({ ...CLUB, orgType: "club", planCode: "club_plus_performance", role: "secretary", jobTitle: "Secrétaire", fullEntitlements: false }),
  ),
  profile(
    "club-tresorier",
    "Club — Trésorier",
    "Club — rôle",
    makeCtx({ ...CLUB, orgType: "club", planCode: "club_plus_performance", role: "treasurer", jobTitle: "Trésorier", fullEntitlements: false }),
  ),
  profile(
    "club-administratif",
    "Club — Administratif",
    "Club — rôle",
    makeCtx({ ...CLUB, orgType: "club", planCode: "club_plus_performance", role: "admin_staff", jobTitle: "Chargée administrative", fullEntitlements: false }),
  ),
  profile(
    "coach-fullcom",
    "Coach indépendant — Full Communication",
    "Autres structures",
    makeCtx({ orgId: "demo-coach", orgName: "Marc Dubois — Coach indépendant", orgType: "coach", planCode: "full_communication", role: "owner", jobTitle: "Coach indépendant", firstName: "Marc", lastName: "Dubois" }),
  ),
  profile(
    "coach-clubplus",
    "Coach indépendant — Club+ Start",
    "Autres structures",
    makeCtx({ orgId: "demo-coach", orgName: "Marc Dubois — Coach indépendant", orgType: "coach", planCode: "club_plus_start", role: "owner", jobTitle: "Coach indépendant" }),
  ),
  profile(
    "academy-fullcom",
    "Académie — Full Communication",
    "Autres structures",
    makeCtx({ orgId: "demo-academy", orgName: "Académie Horizon Sport", orgType: "academy", planCode: "full_communication", role: "manager", jobTitle: "Directeur académie", firstName: "Julie", lastName: "Moreau" }),
  ),
  profile(
    "academy-clubplus",
    "Académie — Club+ Start",
    "Autres structures",
    makeCtx({ orgId: "demo-academy", orgName: "Académie Horizon Sport", orgType: "academy", planCode: "club_plus_start", role: "manager", jobTitle: "Directeur académie", firstName: "Julie", lastName: "Moreau" }),
  ),
  profile(
    "tournament-fullcom",
    "Tournoi — Full Communication",
    "Autres structures",
    makeCtx({ orgId: "demo-tournament", orgName: "Tournoi International U15 — Melun", orgType: "tournament_organizer", planCode: "full_communication", role: "event_admin", firstName: "Nadia", lastName: "Petit" }),
  ),
  profile(
    "tournament-one-off",
    "Tournoi — Prestation unique",
    "Autres structures",
    makeCtx({ orgId: "demo-tournament", orgName: "Tournoi International U15 — Melun", orgType: "tournament_organizer", planCode: "one_off", role: "event_admin", firstName: "Nadia", lastName: "Petit" }),
  ),
  profile(
    "camp-fullcom",
    "Stage/Camp — Full Communication",
    "Autres structures",
    makeCtx({ orgId: "demo-camp", orgName: "Stage Vacances Sport — Été 2026", orgType: "camp", planCode: "full_communication", role: "event_admin", firstName: "Yasmine", lastName: "Fabre" }),
  ),
  profile(
    "camp-one-off",
    "Stage/Camp — Prestation unique",
    "Autres structures",
    makeCtx({ orgId: "demo-camp", orgName: "Stage Vacances Sport — Été 2026", orgType: "camp", planCode: "one_off", role: "event_admin", firstName: "Yasmine", lastName: "Fabre" }),
  ),
  profile(
    "sponsor",
    "Espace partenaire/sponsor",
    "Autres structures",
    makeCtx({ orgId: "demo-sponsor", orgName: "Decathlon Fontainebleau", orgType: "sponsor", planCode: "club_access", role: "partner", firstName: "Karim", lastName: "Saidi", jobTitle: "Responsable magasin" }),
  ),
  profile(
    "generic",
    "Structure générique (Espace Projet)",
    "Autres structures",
    makeCtx({ orgId: "demo-generic", orgName: "Studio Photo Indépendant", orgType: "generic", planCode: "one_off", role: "owner", firstName: "Julien", lastName: "Roche" }),
  ),
  profile(
    "parent",
    "Espace Famille (parent)",
    "Autres structures",
    makeCtx({ orgId: "demo-parent", orgName: "Famille Martin", orgType: "parent", planCode: "club_access", role: "parent", firstName: "Sarah", lastName: "Martin" }),
  ),
  profile(
    "cm-agency",
    "Agence Community Manager",
    "Autres structures",
    makeCtx({ orgId: "demo-cm-agency", orgName: "Agence Kaptur Digital", orgType: "cm_agency", planCode: "one_off", role: "internal_cm", firstName: "Chloé", lastName: "Fontaine" }),
  ),
];

export function getDemoProfile(key: string): DemoProfile | null {
  return DEMO_PROFILES.find((p) => p.key === key) ?? null;
}

export function moduleLabelForPath(nav: NavEntry[], path: string): { label: string; module: ModuleKey } | null {
  const entry = nav.find((e) => e.kind === "item" && e.href === `/${path}`);
  if (!entry || entry.kind !== "item") return null;
  return { label: entry.label, module: entry.module };
}
