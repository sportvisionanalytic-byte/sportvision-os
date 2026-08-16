import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { fetchAgentSubscriptionInfo } from "@/lib/supabase/agentSubscription";
import { AthletesListView } from "./AthletesListView";

// Mes sportifs — voir design-connect-personnel-12-08/README.md § Espace particulier → Mes
// sportifs. Liste, recherche au-delà de 3 sportifs, statuts Accès actif/limité/Profil géré.
// Bannière palier Agent (migration-connect-v57-abonnement-agent.sql) : c'est ICI, côté compte
// AGENT lui-même (pas côté RequestCard.tsx du propriétaire qui accepte), que se trouve le seul CTA
// actionnable vers /particulier/abonnement — voir le commentaire de RequestCard.tsx pour le
// raisonnement complet.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function AthletesPage() {
  const supabase = await createClient();
  const { user, profilParticulier } = await requireParticulierAccount(supabase);

  // athletes, agentInfo et le plafond particulier (migration-connect-v67, RPC
  // connect_particulier_limit/connect_particulier_total_sportifs_count — bannière parent/tuteur/
  // autre, voir AthletesListView.tsx) sont indépendants — voir rapport fluidité perçue 15/08.
  const [athletes, agentInfo, limitRes, totalRes] = await Promise.all([
    fetchMyAthletes(supabase).catch(() => []),
    fetchAgentSubscriptionInfo(supabase),
    supabase.rpc("connect_particulier_limit", { p_user_id: user.id }),
    supabase.rpc("connect_particulier_total_sportifs_count", { p_user_id: user.id }),
  ]);

  return (
    <AthletesListView
      athletes={athletes}
      agentInfo={agentInfo}
      profilParticulier={profilParticulier}
      particulierLimit={typeof limitRes.data === "number" ? limitRes.data : null}
      particulierTotal={typeof totalRes.data === "number" ? totalRes.data : null}
    />
  );
}
