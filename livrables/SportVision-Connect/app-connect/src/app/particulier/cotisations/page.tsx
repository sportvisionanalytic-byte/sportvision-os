import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { FundingTabs, type FundingRow } from "@/app/(joueur)/cotisations/FundingTabs";

// Cotisations (Espace particulier) — réutilise list_my_fundings() et FundingTabs TELS QUELS
// (Espace joueur) : la RPC renvoie déjà toutes les cotisations créées par l'appelant, y compris
// celles créées pour un sportif accompagné (beneficiary_* — migration-connect-v51-espace-
// particulier.sql §6). Seul basePath change les liens internes vers /particulier/cotisations/*.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function CotisationsParticulierPage() {
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("list_my_fundings");
  const fundings = (data || []) as FundingRow[];

  return <FundingTabs fundings={fundings} basePath="/particulier/cotisations" />;
}
