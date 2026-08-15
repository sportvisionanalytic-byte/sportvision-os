import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { FundingDetailView, type FundingDetail } from "./FundingDetailView";

// Détail d'une cotisation — voir design-connect-personnel-12-08/README.md § Cotisations.
// Backend : get_funding_detail() (migration-connect-v50, colonne beneficiary_label ajoutée par
// migration-connect-v51 §8), null si non autorisé => 404 (§35 du master doc : jamais une erreur
// technique exposée). JSX extrait dans FundingDetailView.tsx (14/08) pour être réutilisé tel
// quel par /particulier/cotisations/[id] — comportement de CETTE page strictement inchangé.
export default async function CotisationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { id } = await params;
  const { paiement } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const { data } = await supabase.rpc("get_funding_detail", { p_funding_id: id });
  const funding = data as FundingDetail | null;
  if (!funding) notFound();

  return (
    <AppShell firstName={firstName}>
      <FundingDetailView funding={funding} paiement={paiement} listHref="/cotisations" />
    </AppShell>
  );
}
