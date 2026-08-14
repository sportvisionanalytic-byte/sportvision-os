import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { FundingTabs, type FundingRow } from "@/app/cotisations/FundingTabs";

// Cotisations (Espace particulier) — réutilise list_my_fundings() et FundingTabs TELS QUELS
// (Espace joueur) : la RPC renvoie déjà toutes les cotisations créées par l'appelant, y compris
// celles créées pour un sportif accompagné (beneficiary_* — migration-connect-v51-espace-
// particulier.sql §6). Seul basePath change les liens internes vers /particulier/cotisations/*.
export default async function CotisationsParticulierPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  const { data } = await supabase.rpc("list_my_fundings");
  const fundings = (data || []) as FundingRow[];

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <FundingTabs fundings={fundings} basePath="/particulier/cotisations" />
    </ParticularShell>
  );
}
