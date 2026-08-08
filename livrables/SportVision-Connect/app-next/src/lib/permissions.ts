import type { ActiveContext, FeatureKey, ModuleKey, QuotaKey, ResourceKey } from "./types";
import { PLANS } from "./plans";

// Permissions centralisées — voir README.md § Logique d'abonnement et DATA_MODEL.md
// § Fonctions de permission.
//
// Interdiction formelle de tester `plan.code` ou `organization.type` directement dans un
// écran. Tout passe par ces quatre fonctions. Résolution dans l'ordre : type d'organisation →
// tier de l'offre → entitlements → rôle → périmètre d'équipes → capacités explicites.
// Le premier refus l'emporte.

/** Tier minimum requis pour voir chaque module. Un module absent d'ici est ouvert à tous les tiers. */
const MODULE_MIN_TIER: Partial<Record<ModuleKey, 1 | 2 | 3>> = {
  studio: 2,
  newsroom: 2,
  matchcenter: 2,
  teams: 2,
  sponsors: 2,
  analytics: 2,
  communication: 3,
  validations: 3,
  publications: 3,
  presences: 3,
  reports: 3,
  mycm: 3,
  eventtimeline: 3,
  live: 3,
  sessions: 3,
  camps: 3,
};

const READ_ONLY_ROLES = new Set(["viewer"]);

export function canAccess(ctx: ActiveContext, module: ModuleKey): boolean {
  const minTier = MODULE_MIN_TIER[module];
  if (minTier === undefined) return true;
  return PLANS[ctx.subscription.planCode].tier >= minTier;
}

export function canCreate(ctx: ActiveContext, _resource: ResourceKey): boolean {
  if (ctx.membership.status !== "active") return false;
  if (READ_ONLY_ROLES.has(ctx.membership.role)) return false;
  return true;
}

export function hasEntitlement(ctx: ActiveContext, feature: FeatureKey): boolean {
  return ctx.membership.capabilities.includes(feature);
}

export function hasQuota(ctx: ActiveContext, quota: QuotaKey): boolean {
  const plan = PLANS[ctx.subscription.planCode];
  switch (quota) {
    case "monthly_visuals":
      return plan.monthlyCredits === null || ctx.subscription.creditsRemaining > 0;
    case "season_presences":
      return ctx.subscription.presencesUsed < plan.seasonPresences;
    case "storage":
      return ctx.subscription.storageUsedBytes < ctx.subscription.storageQuotaBytes;
    case "seats":
      return plan.maxUsers === null; // le décompte réel des sièges vit côté serveur
    default:
      return false;
  }
}

/** Raison lisible à afficher sur l'écran « module verrouillé » — voir ACTIONS.md § 26. */
export function lockedModuleMessage(ctx: ActiveContext): string {
  return `Ce module n'est pas activé sur votre contrat actuel (${PLANS[ctx.subscription.planCode].name}). Votre interlocuteur SportVision peut l'ajouter à tout moment.`;
}
