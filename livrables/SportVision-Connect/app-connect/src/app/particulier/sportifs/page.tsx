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
  const { user, profilParticulier } = await requireParticulierAccount(supabase);

  // player, athletes, agentInfo et le plafond particulier (migration-connect-v67, RPC
  // connect_particulier_limit/connect_particulier_total_sportifs_count — bannière parent/tuteur/
  // autre, voir AthletesListView.tsx) sont indépendants — voir rapport fluidité perçue 15/08.
  const [player, athletes, agentInfo, limitRes, totalRes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    fetchAgentSubscriptionInfo(supabase),
    supabase.rpc("connect_particulier_limit", { p_user_id: user.id }),
    supabase.rpc("connect_particulier_total_sportifs_count", { p_user_id: user.id }),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <AthletesListView
        athletes={athletes}
        agentInfo={agentInfo}
        profilParticulier={profilParticulier}
        particulierLimit={typeof limitRes.data === "number" ? limitRes.data : null}
        particulierTotal={typeof totalRes.data === "number" ? totalRes.data : null}
      />
    </ParticularShell>
  );
}
