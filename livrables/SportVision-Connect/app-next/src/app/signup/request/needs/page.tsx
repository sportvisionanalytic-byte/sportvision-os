"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { BESOIN_BLOCKS, useSignup } from "../../signup-context";
import { textareaClass } from "../../signup-styles";

// Écran 4 · Votre besoin (master prompt §22-30). 3 blocs distincts plutôt qu'une seule grille
// (§23-26) ; "Club+" volontairement absent des choix — l'utilisateur est déjà dans une demande
// d'ouverture Club+, le proposer serait redondant (§27-28).
export default function RequestNeedsPage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  useEffect(() => {
    if (state.organizationType === null) router.replace("/signup/request");
  }, [state.organizationType, router]);

  if (state.organizationType === null) return null;

  const canContinue = state.besoins.length > 0;

  function toggle(option: string) {
    const besoins = state.besoins.includes(option) ? state.besoins.filter((o) => o !== option) : [...state.besoins, option];
    patch({ besoins });
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Que souhaitez-vous faire avec SportVision ?</h1>
        <p className="mt-2 text-[14px] text-text-soft">Vous pouvez sélectionner plusieurs besoins.</p>
      </div>

      <div className="flex flex-col gap-6">
        {BESOIN_BLOCKS.map((block) => (
          <div key={block.title} className="flex flex-col gap-2.5">
            <span className="text-[12.5px] font-extrabold uppercase tracking-[.04em] text-text-faint">{block.title}</span>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {block.options.map((option) => {
                const selected = state.besoins.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(option)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3.5 text-left text-[13px] font-semibold transition-colors duration-sv",
                      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.18)]",
                      selected ? "border-brand-blue bg-info-bg" : "border-border hover:border-border-strong",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border",
                        selected ? "border-brand-blue bg-brand-blue text-white" : "border-border-strong",
                      )}
                    >
                      {selected && <Check className="h-3 w-3" aria-hidden />}
                    </span>
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {state.besoins.includes("Autre") && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Précisez votre besoin</span>
          <textarea
            value={state.besoinAutrePrecision}
            onChange={(e) => patch({ besoinAutrePrecision: e.target.value })}
            className={textareaClass}
            placeholder="Décrivez votre besoin."
          />
        </label>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/signup/request/contact")}>
          Retour
        </Button>
        <Button disabled={!canContinue} className="w-full sm:w-auto" onClick={() => router.push("/signup/request/review")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
