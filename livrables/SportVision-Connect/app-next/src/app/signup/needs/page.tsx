"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { NEEDS_OPTIONS, useSignup } from "../signup-context";
import { textareaClass } from "../signup-styles";

// Étape 4 · Besoins — voir ACTIONS.md § 2. 8 cases à cocher + texte libre, transmis au
// conseiller assigné à l'issue de l'inscription.
export default function SignupNeedsPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { needs } = state;

  function toggle(option: string) {
    const selected = needs.selected.includes(option)
      ? needs.selected.filter((o) => o !== option)
      : [...needs.selected, option];
    patch({ needs: { ...needs, selected } });
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Quels sont vos besoins ?</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Sélectionnez tout ce qui s&apos;applique — votre conseiller SportVision en tiendra compte.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {NEEDS_OPTIONS.map((option) => {
          const selected = needs.selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3.5 text-left text-[13px] font-semibold transition-colors duration-sv",
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

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold text-text-soft">Précisez si besoin (facultatif)</span>
        <textarea
          value={needs.freeText}
          onChange={(e) => patch({ needs: { ...needs, freeText: e.target.value } })}
          className={textareaClass}
          placeholder="Décrivez votre projet, vos échéances ou toute information utile."
        />
      </label>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/org")}>
          Retour
        </Button>
        <Button onClick={() => router.push("/signup/plan")}>Continuer</Button>
      </div>
    </div>
  );
}
