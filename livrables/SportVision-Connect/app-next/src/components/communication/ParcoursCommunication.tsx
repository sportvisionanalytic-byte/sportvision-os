"use client";

// La frise d'une demande de communication : Demande → Brief → Production → Validation →
// Programmation → Publié. L'étape se déduit des statuts réels (lib/communication/parcours.ts) :
// rien n'est saisi à la main, rien ne peut diverger.

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { ETAPES_PARCOURS, type EtatParcours } from "@/lib/communication/parcours";

export function ParcoursCommunication({ etat }: { etat: EtatParcours }) {
  if (etat.etape < 0) {
    return (
      <div className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[12.5px] font-bold text-text-soft">{etat.arret}</div>
    );
  }
  return (
    <ol className="flex items-start gap-0.5 overflow-x-auto pb-1" aria-label="Parcours de la demande">
      {ETAPES_PARCOURS.map((libelle, i) => {
        const fait = i < etat.etape;
        const courant = i === etat.etape;
        return (
          <li key={libelle} className="flex flex-none items-start gap-0.5" aria-current={courant ? "step" : undefined}>
            <span className="flex w-[64px] flex-col items-center gap-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold",
                  fait && "bg-success-fg text-white",
                  courant && "bg-gradient-to-r from-brand-blue to-brand-violet text-white",
                  !fait && !courant && "bg-surface-sunken text-text-faint",
                )}
              >
                {fait ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-center text-[10px] font-bold leading-tight", courant ? "text-text" : "text-text-faint")}>
                {libelle}
              </span>
            </span>
            {i < ETAPES_PARCOURS.length - 1 && <span className={cn("mt-[10px] h-px w-2.5 flex-none", fait ? "bg-success-fg" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
