import type { ActiveContext, FeatureKey, ModuleKey, QuotaKey, ResourceKey } from "./types";
import { PLANS } from "./plans";
import { MODULE_TO_CONNECT_MODULE, PHASE1_READY_MODULES } from "./supabase/entitlements";

// Permissions centralisées — voir README.md § Logique d'abonnement et DATA_MODEL.md
// § Fonctions de permission.
//
// Interdiction formelle de tester `plan.code` ou `organization.type` directement dans un
// écran. Tout passe par ces quatre fonctions. Résolution dans l'ordre : type d'organisation →
// tier de l'offre → entitlements → rôle → périmètre d'équipes → capacités explicites.
// Le premier refus l'emporte.

const READ_ONLY_ROLES = new Set(["viewer"]);

/**
 * Phase 1 (Espace Club branché sur données réelles, voir le plan de migration) : un module
 * absent de PHASE1_READY_MODULES est verrouillé, jamais ouvert par défaut — sinon un club réel
 * verrait du contenu mock (organisations/joueurs fictifs) sur un module pas encore branché.
 * Pour un module prêt, l'accès réel est piloté par organization_entitlements (via
 * MODULE_TO_CONNECT_MODULE) ; un module prêt sans clé d'entitlement est "core" (inclus dans
 * toute offre Club+, cf. ARCHITECTURE-CONNECT.md § Correspondance offres → entitlements).
 */
export function canAccess(ctx: ActiveContext, module: ModuleKey): boolean {
  if (!PHASE1_READY_MODULES.has(module)) return false;
  const connectModuleKey = MODULE_TO_CONNECT_MODULE[module];
  if (!connectModuleKey) return true;
  return ctx.entitlements?.[connectModuleKey]?.actif ?? false;
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
