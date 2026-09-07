"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Le webhook Stripe peut avoir quelques secondes de retard sur la redirection du navigateur : le
// paiement est fait, mais le jeton n'est pas encore écrit. Ce n'est pas une erreur, c'est une
// attente — on réessaie quelques fois plutôt que d'annoncer un échec à quelqu'un qui vient de
// payer, ce qui serait la pire chose à lui montrer.
const TENTATIVES_MAX = 12;
const DELAI_MS = 1500;

export function OrderExchange({ orderId }: { orderId: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(orderId ? null : "Commande introuvable.");
  const essais = useRef(0);

  const tenter = useCallback(async () => {
    if (!orderId) return;
    const { data } = await createClient().functions.invoke("gallery-download", { body: { orderId } });
    const payload = data as { token?: string; error?: string; pending?: boolean } | null;
    if (payload?.token) {
      router.replace(`/gallery/commande/${encodeURIComponent(payload.token)}`);
      return;
    }
    essais.current += 1;
    if (essais.current >= TENTATIVES_MAX) {
      setError(
        payload?.error ??
          "Votre paiement est bien enregistré, mais la préparation prend plus de temps que prévu. Le lien vous arrive par e-mail dans quelques instants.",
      );
      return;
    }
    setTimeout(tenter, DELAI_MS);
  }, [orderId, router]);

  useEffect(() => {
    void tenter();
  }, [tenter]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center text-text"
      style={{
        backgroundImage:
          "radial-gradient(820px 560px at 50% -12%, rgba(168,85,247,.2), transparent 70%), radial-gradient(620px 460px at 0% 100%, rgba(34,211,238,.08), transparent 70%)",
      }}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
        <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.16em] text-transparent">
          Galerie
        </span>
      </div>
      <h1 className="mt-6 font-sora text-[22px] font-extrabold tracking-tight">
        {error ? "Paiement enregistré" : "Paiement confirmé"}
      </h1>
      <p className="mt-3 max-w-[400px] text-[13.5px] leading-relaxed text-text-tertiary">
        {error ?? "Nous préparons vos photos…"}
      </p>
    </div>
  );
}
