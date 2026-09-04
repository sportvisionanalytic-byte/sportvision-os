import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { GuestMediaCheckoutView } from "./GuestMediaCheckoutView";

// Page publique du checkout média invité (04/09/2026, prompt #8 backlog Club+ V2) — SANS COMPTE,
// même patron que /cotisation/[token] et /join/[code] (server component, RPC lecture seule
// grantée à `anon`, aucune donnée personnelle exposée). "/media-checkout" whitelisté dans
// PUBLIC_PATHS (src/lib/supabase/middleware.ts).
export interface MediaCheckoutPreview {
  valide: boolean;
  raison: string | null;
  club_nom: string | null;
  produit_nom: string | null;
  prix_cents: number | null;
  devise: string | null;
  beneficiaire_prenom: string | null;
  produit_physique: boolean | null;
}

const RAISON_LABEL: Record<string, string> = {
  introuvable: "Ce lien n'existe pas ou n'est plus valide.",
  expire: "Ce lien a expiré.",
  epuise: "Ce lien a déjà été utilisé.",
  produit_indisponible: "Ce produit n'est plus disponible.",
};

export default async function MediaCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { token } = await params;
  const { paiement } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("preview_media_checkout_token", { p_token: token });
  const preview = (Array.isArray(data) ? data[0] : data) as MediaCheckoutPreview | null;

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

      <div className="flex flex-1 items-center justify-center px-5 pb-8 pt-7">
        <div className="w-full max-w-[420px]">
          {preview?.valide ? (
            <GuestMediaCheckoutView
              token={token}
              preview={preview}
              paiementReturn={paiement === "succes" ? "succes" : paiement === "annule" ? "annule" : null}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-surface p-7 text-center">
              <h1 className="text-[20px] font-extrabold tracking-tight">Lien indisponible</h1>
              <p className="mt-3 text-[13.5px] leading-relaxed text-text-soft">
                {(preview?.raison && RAISON_LABEL[preview.raison]) ?? "Ce lien n'est plus valide."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
