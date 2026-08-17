import type { SupabaseClient } from "@supabase/supabase-js";

// Champs `clubs` nécessaires à « Mon offre » (CLUB-PLUS-PRODUCT-BIBLE.md §19) et au choix
// Checkout/Portail de facturation — jamais exposés par ActiveContext.subscription
// (session.ts pose subscription.status = "active" en dur pour tout club, y compris un club en
// pilot_mode qui n'a jamais payé : inutilisable pour décider si un vrai abonnement Stripe existe).
export interface ClubSubscriptionInfo {
  plan: string;
  engagement: string | null;
  pilotMode: boolean;
  creditsMonthly: number;
  creditsBalance: number;
  subscriptionStatus: string | null;
  hasActiveStripeSubscription: boolean;
}

interface ClubSubscriptionRow {
  plan: string;
  engagement: string | null;
  pilot_mode: boolean;
  credits_monthly: number;
  credits_balance: number;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
}

export async function fetchClubSubscriptionInfo(supabase: SupabaseClient, clubId: string): Promise<ClubSubscriptionInfo | null> {
  const { data } = await supabase
    .from("clubs")
    .select("plan, engagement, pilot_mode, credits_monthly, credits_balance, subscription_status, stripe_subscription_id")
    .eq("id", clubId)
    .maybeSingle();
  if (!data) return null;
  const row = data as ClubSubscriptionRow;
  return {
    plan: row.plan,
    engagement: row.engagement,
    pilotMode: row.pilot_mode,
    creditsMonthly: row.credits_monthly,
    creditsBalance: row.credits_balance,
    subscriptionStatus: row.subscription_status,
    hasActiveStripeSubscription: Boolean(row.stripe_subscription_id) && row.subscription_status === "actif",
  };
}
