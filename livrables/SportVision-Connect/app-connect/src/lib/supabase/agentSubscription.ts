import type { SupabaseClient } from "@supabase/supabase-js";

// Abonnement Agent (Espace particulier) — voir migration-connect-v57-abonnement-agent.sql §2.
// connect_agent_subscription_status() résout TOUJOURS l'état de L'APPELANT (jamais un paramètre
// user_id — pas de fuite du palier/nombre de sportifs suivis d'un tiers). "gratuit" n'est jamais
// une ligne en base : c'est l'état par défaut en l'absence d'abonnement actif.
export type AgentTier = "gratuit" | "starter" | "growth" | "pro";
export type AgentSubscriptionStatus = "gratuit" | "incomplete" | "active" | "past_due" | "canceled";

export interface AgentSubscriptionInfo {
  tier: AgentTier;
  status: AgentSubscriptionStatus;
  athletesCount: number;
  limit: number;
  canAcceptMore: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyDiscountUsedAt: string | null;
}

interface StatusRpcResult {
  tier: AgentTier;
  status: AgentSubscriptionStatus;
  athletes_count: number;
  limit: number;
  can_accept_more: boolean;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  monthly_discount_used_at: string | null;
}

const DEFAULT_INFO: AgentSubscriptionInfo = {
  tier: "gratuit",
  status: "gratuit",
  athletesCount: 0,
  limit: 2,
  canAcceptMore: true,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  monthlyDiscountUsedAt: null,
};

export async function fetchAgentSubscriptionInfo(supabase: SupabaseClient): Promise<AgentSubscriptionInfo> {
  const { data, error } = await supabase.rpc("connect_agent_subscription_status");
  if (error || !data) return DEFAULT_INFO;
  const r = data as StatusRpcResult;
  return {
    tier: r.tier,
    status: r.status,
    athletesCount: r.athletes_count,
    limit: r.limit,
    canAcceptMore: r.can_accept_more,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    monthlyDiscountUsedAt: r.monthly_discount_used_at,
  };
}

export const AGENT_TIER_LABEL: Record<AgentTier, string> = {
  gratuit: "Gratuit",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};

export const AGENT_TIER_PRICE_LABEL: Record<AgentTier, string> = {
  gratuit: "0 €/mois",
  starter: "9,90 €/mois",
  growth: "15,90 €/mois",
  pro: "24,90 €/mois",
};

export interface AgentTierPlan {
  tier: "starter" | "growth" | "pro";
  label: string;
  priceLabel: string;
  rangeLabel: string;
  benefits: string[];
}

// Catalogue d'affichage des 3 paliers payants — les MONTANTS affichés ici sont purement
// informatifs (texte statique, cohérent avec les 3 Price Stripe créés manuellement par Fouka,
// migration-connect-v57 §résumé final). Le prix RÉELLEMENT facturé vient toujours de Stripe (Price
// ID résolu côté edge function depuis les variables d'environnement) — jamais de ce fichier.
export const AGENT_TIER_PLANS: AgentTierPlan[] = [
  {
    tier: "starter",
    label: "Starter",
    priceLabel: "9,90 €/mois",
    rangeLabel: "3 à 5 sportifs suivis",
    benefits: ["-5% sur Montage Compilation"],
  },
  {
    tier: "growth",
    label: "Growth",
    priceLabel: "15,90 €/mois",
    rangeLabel: "6 à 10 sportifs suivis",
    benefits: ["-5% sur Montage Compilation"],
  },
  {
    tier: "pro",
    label: "Pro",
    priceLabel: "24,90 €/mois",
    rangeLabel: "11 à 20 sportifs suivis",
    benefits: ["-5% sur Montage Compilation", "-10% sur une prestation au choix, une fois par mois"],
  },
];

export const AGENT_STATUS_LABEL: Record<AgentSubscriptionStatus, string> = {
  gratuit: "Gratuit",
  incomplete: "Paiement en attente",
  active: "Actif",
  past_due: "Paiement en échec",
  canceled: "Résilié",
};
