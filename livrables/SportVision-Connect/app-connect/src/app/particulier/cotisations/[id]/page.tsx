import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { FundingDetailView, type FundingDetail } from "@/app/cotisations/[id]/FundingDetailView";

// Détail d'une cotisation (Espace particulier) — réutilise get_funding_detail() et
// FundingDetailView TELS QUELS (voir /cotisations/[id]/page.tsx) : seuls le shell et le lien de
// retour changent.
export default async function CotisationDetailParticulierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { id } = await params;
  const { paiement } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  const { data } = await supabase.rpc("get_funding_detail", { p_funding_id: id });
  const funding = data as FundingDetail | null;
  if (!funding) notFound();

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <FundingDetailView funding={funding} paiement={paiement} listHref="/particulier/cotisations" />
    </ParticularShell>
  );
}
