import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { FundingDetailView, type FundingDetail } from "@/app/(joueur)/cotisations/[id]/FundingDetailView";

// Détail d'une cotisation (Espace particulier) — réutilise get_funding_detail() et
// FundingDetailView TELS QUELS (voir /cotisations/[id]/page.tsx) : seuls le shell et le lien de
// retour changent.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
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
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("get_funding_detail", { p_funding_id: id });
  const funding = data as FundingDetail | null;
  if (!funding) notFound();

  return <FundingDetailView funding={funding} paiement={paiement} listHref="/particulier/cotisations" />;
}
