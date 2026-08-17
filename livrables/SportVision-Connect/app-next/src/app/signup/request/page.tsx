"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { REQUEST_ORG_TYPE_OPTIONS, useSignup } from "../signup-context";

// Écran 1 · Type de structure — tunnel unifié "Demande d'ouverture Club+"
// (SIGNUP-UNIFIE-MASTER-PROMPT.md §4-7). Ce parcours ne crée AUCUN compte ni organisation
// active : il aboutit à une demande transmise au staff SportVision pour validation manuelle
// (connect-club-signup-request, déjà déployée — voir signup-context.tsx en tête de fichier).
export default function RequestTypePage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  const canContinue = state.organizationType !== null;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Quel type de structure souhaitez-vous inscrire sur Club+ ?</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Ce choix nous permet d&apos;adapter votre demande et votre futur espace professionnel.
        </p>
        <p className="mt-3 text-[12.5px] text-text-faint">
          L&apos;ouverture de votre espace sera vérifiée par SportVision avant activation.
        </p>
      </div>

      <div role="radiogroup" aria-label="Type de structure" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {REQUEST_ORG_TYPE_OPTIONS.map((option) => {
          const selected = state.organizationType === option.type;
          return (
            <button
              key={option.type}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => patch({ organizationType: option.type })}
              className={cn(
                "flex flex-col items-start gap-1 rounded-sv-card border p-4 text-left transition-[transform,border-color,box-shadow] duration-sv hover:-translate-y-0.5",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.18)]",
                selected
                  ? "border-brand-blue bg-info-bg shadow-sv-card-hover"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-[15px] font-extrabold tracking-tight">{option.label}</span>
                {selected && (
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-blue text-white">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                )}
              </span>
              <span className="text-[12.5px] text-text-soft">{option.description}</span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button disabled={!canContinue} onClick={() => router.push("/signup/request/structure")} className="w-full sm:w-auto">
          Continuer
        </Button>
      </div>
    </div>
  );
}
