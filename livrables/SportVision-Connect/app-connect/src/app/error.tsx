"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

// Filet de sécurité — capture toute exception non gérée dans un Server/Client Component de
// l'arbre `app/` (au-delà de ce que les `.catch(() => ...)` et `setError(...)` couvrent déjà
// page par page). Sans ce fichier, Next.js affiche son écran d'erreur générique par défaut, en
// anglais et non stylé — jamais acceptable ici (audit externe du 16/08 : toujours un message
// humain en français, jamais une erreur technique brute). Reprend le pattern visuel déjà utilisé
// pour les états d'erreur ponctuels (voir CommandeDetailView.tsx, prestations/[id]/reserver/
// page.tsx) plutôt que d'inventer un nouveau style.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-5 py-10">
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-danger-bg">
          <span className="material-symbols-rounded !text-[24px] text-danger" aria-hidden="true">error</span>
        </span>
        <span className="font-sora text-[18px] font-semibold">Une erreur est survenue</span>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Impossible d&apos;afficher cette page pour le moment. Réessayez dans quelques instants — si le problème persiste,
          contactez-nous depuis l&apos;aide.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" onClick={() => reset()}>
            Réessayer
          </Button>
          <Link href="/" className="rounded-sv border border-border-strong bg-bg-elevated px-4 py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover">
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
