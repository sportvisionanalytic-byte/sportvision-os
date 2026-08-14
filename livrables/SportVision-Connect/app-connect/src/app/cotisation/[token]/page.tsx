import { notFound } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { PublicFundingView } from "./PublicFundingView";

export interface PublicFunding {
  titre: string;
  contexte: string | null;
  catalogue_offre_nom: string | null;
  montant_cible: number;
  montant_collecte: number;
  repartition_mode: "egale" | "libre";
  nb_participants_prevu: number | null;
  date_limite: string | null;
  statut: "ouverte" | "objectif_atteint" | "expiree" | "annulee";
  participants_count: number;
}

// Page publique de participation à une cotisation — SANS COMPTE — voir
// design-connect-personnel-12-08/Connect Cotisation Publique.dc.html et README.md § Cotisations.
// "/cotisation" (singulier) est déjà whitelisté comme chemin public dans
// src/lib/supabase/middleware.ts PUBLIC_PATHS (vérifié, pas dupliqué ici).
// Backend : get_public_funding() (migration-connect-v50), lecture seule, granted à `anon` —
// aucune donnée personnelle de participant n'est exposée (ni e-mail, ni nom).
export default async function PublicFundingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { token } = await params;
  const { paiement } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_funding", { p_token: token });
  const funding = data as PublicFunding | null;
  if (!funding) notFound();

  return (
    <div
      className="flex min-h-screen flex-col bg-bg font-sans text-text"
      style={{
        backgroundImage:
          "radial-gradient(820px 560px at 50% -12%, rgba(168,85,247,.24), transparent 70%), radial-gradient(620px 460px at 0% 100%, rgba(34,211,238,.1), transparent 70%)",
      }}
    >
      <div className="flex flex-none items-center justify-center gap-2.5 border-b border-border px-6 py-5">
        <Image src="/uploads/logo.png" alt="SportVision Connect" width={30} height={30} className="object-contain" />
        <div className="flex items-baseline gap-1.5">
          <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
          <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
            Connect
          </span>
        </div>
      </div>

      <div className="flex flex-1 justify-center px-5 pb-8 pt-7">
        <div className="w-full max-w-[460px]">
          <PublicFundingView token={token} initial={funding} paiementReturn={paiement === "succes" ? "succes" : paiement === "annule" ? "annule" : null} />
        </div>
      </div>
    </div>
  );
}
