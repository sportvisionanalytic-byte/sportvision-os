import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchClubDonneesRestreintes } from "@/lib/data/club/organization";

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
}

export async function fetchClubSubscriptionInfo(supabase: SupabaseClient, clubId: string): Promise<ClubSubscriptionInfo | null> {
  // 11/09/2026 — L'identifiant d'abonnement Stripe ne se lit plus dans `clubs` : décision de
  // Fouka, il n'est lisible que par l'Owner Club+ et le Président (les deux seuls qui voient
  // « Mon offre »), par club_donnees_restreintes(). La colonne est fermée à `authenticated` :
  // la garder dans ce `select` ferait échouer toute la carte.
  const [{ data }, restreintes] = await Promise.all([
    supabase
      .from("clubs")
      .select("plan, engagement, pilot_mode, credits_monthly, credits_balance, subscription_status")
      .eq("id", clubId)
      .maybeSingle(),
    fetchClubDonneesRestreintes(supabase, clubId),
  ]);
  if (!data) return null;
  const row = data as ClubSubscriptionRow;
  return {
    plan: row.plan,
    engagement: row.engagement,
    pilotMode: row.pilot_mode,
    creditsMonthly: row.credits_monthly,
    creditsBalance: row.credits_balance,
    subscriptionStatus: row.subscription_status,
    hasActiveStripeSubscription: Boolean(restreintes.stripeSubscriptionId) && row.subscription_status === "actif",
  };
}
