"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Error boundary global Next.js (erreur 500 / exception non gérée dans un Server ou Client
// Component). Voir MASTER-CONNECT-V1.md §35 et §54 : message humain, action de réessai,
// journal technique côté serveur uniquement — jamais de stack trace affichée au client.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Le detail technique (message, digest) reste dans la console/les logs serveur, jamais
    // rendu à l'écran.
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center text-text">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-bold uppercase tracking-wide text-text-faint">Erreur inattendue</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Un problème est survenu</h1>
        <p className="max-w-[420px] text-[14px] leading-relaxed text-text-soft">
          Quelque chose ne s&apos;est pas passé comme prévu. Réessayez, et si le problème persiste,
          contactez SportVision : nous avons été informés de l&apos;incident.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={() => reset()}>
          Réessayer
        </Button>
        <Link href="/dashboard">
          <Button variant="secondary">Retour à mon espace</Button>
        </Link>
      </div>
    </div>
  );
}
