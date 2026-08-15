import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { FundingTabs, type FundingRow } from "./FundingTabs";

// Cotisations — voir design-connect-personnel-12-08/README.md § Espace joueur → Cotisations.
// Backend : list_my_fundings() (migration-connect-v50), ne renvoie que les cotisations
// visibles par l'appelant (créateur, membre du groupe, ou contributeur) — le filtrage par
// onglet se fait ensuite côté client sur ce jeu déjà restreint.
export default async function CotisationsPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  // player et fundings sont indépendants (list_my_fundings ne prend aucun paramètre dérivé de
  // player) — voir rapport fluidité perçue 15/08.
  const [player, fundingsRes] = await Promise.all([buildPlayerContext(supabase, user.id), supabase.rpc("list_my_fundings")]);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";
  const fundings = (fundingsRes.data || []) as FundingRow[];

  return (
    <AppShell firstName={firstName}>
      <FundingTabs fundings={fundings} />
    </AppShell>
  );
}
