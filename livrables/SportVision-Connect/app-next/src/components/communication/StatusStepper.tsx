"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { PUBLICATION_STATUS_FLOW, PUBLICATION_STATUS_LABELS, type PublicationStatus } from "@/lib/types/communication";
import { Badge } from "@/components/ui/Badge";
import { publicationStatusTone } from "./statusTone";

// Frise de 8 statuts — ACTIONS.md § 14 « Fiche publication », README.md § Chaînes de statuts.
// Erreur de publication et Annulée sont des exceptions hors frise, affichées à part.
export function StatusStepper({ status }: { status: PublicationStatus }) {
  if (status === "publish_error" || status === "cancelled") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-danger-bg px-4 py-3">
        <Badge tone={publicationStatusTone(status)}>{PUBLICATION_STATUS_LABELS[status]}</Badge>
        <span className="text-[12.5px] font-semibold text-danger-fg">
          {status === "cancelled" ? "Cette publication a été annulée." : "La publication n'est pas partie en ligne, votre Community Manager s'en occupe."}
        </span>
      </div>
    );
  }

  const currentIndex = PUBLICATION_STATUS_FLOW.indexOf(status);

  return (
    <div className="flex items-start gap-0.5 overflow-x-auto pb-1.5">
      {PUBLICATION_STATUS_FLOW.map((step, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={step} className="flex flex-none items-start gap-0.5">
            <div className="flex w-[76px] flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10.5px] font-extrabold",
                  isDone && "bg-success-fg text-white",
                  isCurrent && "bg-brand-blue text-white",
                  !isDone && !isCurrent && "bg-surface-sunken text-text-faint",
                )}
              >
                {isDone ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-center text-[10px] font-bold leading-tight",
                  isCurrent ? "text-text" : isDone ? "text-text-soft" : "text-text-faint",
                )}
              >
                {PUBLICATION_STATUS_LABELS[step]}
              </span>
            </div>
            {i < PUBLICATION_STATUS_FLOW.length - 1 && (
              <span className={cn("mt-[11px] h-px w-4 flex-none", isDone ? "bg-success-fg" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
