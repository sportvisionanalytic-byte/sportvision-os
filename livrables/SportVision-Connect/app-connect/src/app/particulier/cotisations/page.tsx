import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { FundingTabs, type FundingRow } from "@/app/cotisations/FundingTabs";

// Cotisations (Espace particulier) — réutilise list_my_fundings() et FundingTabs TELS QUELS
// (Espace joueur) : la RPC renvoie déjà toutes les cotisations créées par l'appelant, y compris
// celles créées pour un sportif accompagné (beneficiary_* — migration-connect-v51-espace-
// particulier.sql §6). Seul basePath change les liens internes vers /particulier/cotisations/*.
export default async function CotisationsParticulierPage() {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et fundings sont indépendants (list_my_fundings ne prend aucun paramètre
  // dérivé de player/athletes) — voir rapport fluidité perçue 15/08.
  const [player, athletes, fundingsRes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    supabase.rpc("list_my_fundings"),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const fundings = (fundingsRes.data || []) as FundingRow[];

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <FundingTabs fundings={fundings} basePath="/particulier/cotisations" />
    </ParticularShell>
  );
}
