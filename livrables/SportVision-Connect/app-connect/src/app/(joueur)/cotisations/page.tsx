import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { FundingTabs, type FundingRow } from "./FundingTabs";

// Cotisations — voir design-connect-personnel-12-08/README.md § Espace joueur → Cotisations.
// Backend : list_my_fundings() (migration-connect-v50), ne renvoie que les cotisations
// visibles par l'appelant (créateur, membre du groupe, ou contributeur) — le filtrage par
// onglet se fait ensuite côté client sur ce jeu déjà restreint.
//
// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function CotisationsPage() {
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

  const { data } = await supabase.rpc("list_my_fundings");
  const fundings = (data || []) as FundingRow[];

  return <FundingTabs fundings={fundings} />;
}
