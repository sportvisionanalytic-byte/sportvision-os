"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { CLUB_BESOIN_OPTIONS, useSignup } from "../../signup-context";
import { textareaClass } from "../../signup-styles";

// Étape 3 · Votre besoin — tunnel /signup/club-request/*. Choix multiples, transcrits verbatim
// depuis le brief de Fouka du 12/08/2026 (voir CLUB_BESOIN_OPTIONS, signup-context.tsx).
export default function ClubRequestStep3Page() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { clubRequest } = state;

  useEffect(() => {
    if (state.orgType !== "club") router.replace("/signup/type");
  }, [state.orgType, router]);

  const canContinue = clubRequest.besoins.length > 0;

  function toggle(option: string) {
    const besoins = clubRequest.besoins.includes(option)
      ? clubRequest.besoins.filter((o) => o !== option)
      : [...clubRequest.besoins, option];
    patch({ clubRequest: { ...clubRequest, besoins } });
  }

  if (state.orgType !== "club") return null;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Pourquoi souhaitez-vous rejoindre SportVision Connect ?</h1>
        <p className="mt-2 text-[14px] text-text-soft">Plusieurs choix possibles.</p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {CLUB_BESOIN_OPTIONS.map((option) => {
          const selected = clubRequest.besoins.includes(option);
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

      {clubRequest.besoins.includes("Autre") && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Précisez (facultatif)</span>
          <textarea
            value={clubRequest.besoinAutrePrecision}
            onChange={(e) => patch({ clubRequest: { ...clubRequest, besoinAutrePrecision: e.target.value } })}
            className={textareaClass}
            placeholder="Décrivez votre besoin."
          />
        </label>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/club-request/contact")}>
          Retour
        </Button>
        <Button disabled={!canContinue} onClick={() => router.push("/signup/club-request/review")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
