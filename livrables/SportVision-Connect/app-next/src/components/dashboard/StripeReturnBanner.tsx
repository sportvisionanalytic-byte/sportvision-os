"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

// Affiche le retour réel de Stripe Checkout. `success_url`/`cancel_url` sont codées en dur dans
// create-clubplus-subscription-checkout (édge function existante, jamais modifiée pour limiter le
// risque de redéploiement sur du code financier) vers `${connectUrl}/?abonnement=succes|annule` —
// src/app/page.tsx relaie ce paramètre vers /dashboard, seule route dont on est sûr qu'elle existe
// pour tout type de compte. Le paiement lui-même n'est confirmé écrit qu'après le webhook Stripe
// (jamais depuis ce retour navigateur) : "succes" ici veut dire "Stripe a redirigé en succès", pas
// "l'abonnement est déjà actif en base" — d'où un message qui n'affirme jamais l'activation.
export function StripeReturnBanner() {
  return (
    <Suspense fallback={null}>
      <StripeReturnBannerContent />
    </Suspense>
  );
}

function StripeReturnBannerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const abonnement = searchParams.get("abonnement");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!abonnement) return;
    // Nettoie l'URL une fois le message affiché : un rafraîchissement ne doit pas le répéter.
    router.replace("/dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abonnement]);

  if (!abonnement || dismissed) return null;
  if (abonnement !== "succes" && abonnement !== "annule") return null;

  const isSuccess = abonnement === "succes";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3.5",
        isSuccess ? "border-success-fg/30 bg-success-bg" : "border-warning-fg/30 bg-warning-bg",
      )}
    >
      {isSuccess ? (
        <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-success-fg" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning-fg" aria-hidden />
      )}
      <div className={cn("flex-1 text-[13px] font-semibold", isSuccess ? "text-success-fg" : "text-warning-fg")}>
        {isSuccess ? (
          <>
            Paiement confirmé par Stripe. Votre abonnement s&apos;active en général en quelques secondes — si les crédits
            n&apos;apparaissent pas tout de suite dans Facturation, rafraîchissez la page dans un instant.
          </>
        ) : (
          <>Paiement annulé, aucun montant n&apos;a été débité. Vous pouvez réessayer à tout moment depuis Facturation.</>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Fermer"
        className={cn("shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100")}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
