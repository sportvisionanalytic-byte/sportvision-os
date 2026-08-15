import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { fetchAgentSubscriptionInfo } from "@/lib/supabase/agentSubscription";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { AthletesListView } from "./AthletesListView";

// Mes sportifs — voir design-connect-personnel-12-08/README.md § Espace particulier → Mes
// sportifs. Liste, recherche au-delà de 3 sportifs, statuts Accès actif/limité/Profil géré.
// Bannière palier Agent (migration-connect-v57-abonnement-agent.sql) : c'est ICI, côté compte
// AGENT lui-même (pas côté RequestCard.tsx du propriétaire qui accepte), que se trouve le seul CTA
// actionnable vers /particulier/abonnement — voir le commentaire de RequestCard.tsx pour le
// raisonnement complet.
export default async function AthletesPage() {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et agentInfo sont indépendants — voir rapport fluidité perçue 15/08.
  const [player, athletes, agentInfo] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    fetchAgentSubscriptionInfo(supabase),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <AthletesListView athletes={athletes} agentInfo={agentInfo} />
    </ParticularShell>
  );
}
