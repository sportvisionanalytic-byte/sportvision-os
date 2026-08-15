import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { fetchAgentSubscriptionInfo } from "@/lib/supabase/agentSubscription";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { AbonnementView } from "./AbonnementView";

// Mon abonnement (Espace particulier) — voir migration-connect-v57-abonnement-agent.sql. Palier
// actuel, sportifs suivis en tant qu'agent / limite du palier, changement de palier, résiliation.
// Backend : connect_agent_subscription_status() (RPC, lecture) + create-agent-subscription-
// checkout / manage-agent-subscription / connect-agent-billing-portal (edge functions, écriture —
// jamais un statut posé directement par cette page, seul le webhook Stripe confirme).
export default async function AbonnementPage({
  searchParams,
}: {
  searchParams: Promise<{ abonnement?: string }>;
}) {
  const { abonnement } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et info sont indépendants — voir rapport fluidité perçue 15/08.
  const [player, athletes, info] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    fetchAgentSubscriptionInfo(supabase),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <AbonnementView initialInfo={info} returnStatus={abonnement === "succes" ? "succes" : abonnement === "annule" ? "annule" : null} />
    </ParticularShell>
  );
}
