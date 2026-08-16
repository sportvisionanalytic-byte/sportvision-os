import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchAgentSubscriptionInfo } from "@/lib/supabase/agentSubscription";
import { AbonnementView } from "./AbonnementView";

// Mon abonnement (Espace particulier) — voir migration-connect-v57-abonnement-agent.sql. Palier
// actuel, sportifs suivis en tant qu'agent / limite du palier, changement de palier, résiliation.
// Backend : connect_agent_subscription_status() (RPC, lecture) + create-agent-subscription-
// checkout / manage-agent-subscription / connect-agent-billing-portal (edge functions, écriture —
// jamais un statut posé directement par cette page, seul le webhook Stripe confirme).
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function AbonnementPage({
  searchParams,
}: {
  searchParams: Promise<{ abonnement?: string }>;
}) {
  const { abonnement } = await searchParams;
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const info = await fetchAgentSubscriptionInfo(supabase);

  return (
    <AbonnementView initialInfo={info} returnStatus={abonnement === "succes" ? "succes" : abonnement === "annule" ? "annule" : null} />
  );
}
