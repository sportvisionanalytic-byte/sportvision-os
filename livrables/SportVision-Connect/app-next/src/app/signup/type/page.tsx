"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { ORG_TYPE_OPTIONS, useSignup } from "../signup-context";

// Étape 1 · Structure (+ Affiliation pour un joueur) — voir ACTIONS.md § 2.
export default function SignupTypePage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  const canContinue = state.orgType !== null && (state.orgType !== "player" || state.playerAffiliation !== null);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Quel type de structure créez-vous ?</h1>
        <p className="mt-2 text-[14px] text-text-soft">Ce choix conditionne toute la suite de votre inscription.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ORG_TYPE_OPTIONS.map((option) => {
          const selected = state.orgType === option.type;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => patch({ orgType: option.type, playerAffiliation: null })}
              className={cn(
                "flex flex-col items-start gap-1 rounded-sv-card border p-4 text-left transition-[transform,border-color,box-shadow] duration-sv hover:-translate-y-0.5",
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

      {state.orgType === "player" && (
        <Card className="animate-svfade p-5">
          <div className="text-[13.5px] font-extrabold">Comment souhaitez-vous gérer votre espace ?</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => patch({ playerAffiliation: "self" })}
              className={cn(
                "rounded-xl border p-3.5 text-left transition-colors duration-sv",
                state.playerAffiliation === "self"
                  ? "border-brand-blue bg-info-bg"
                  : "border-border hover:border-border-strong",
              )}
            >
              <div className="text-[13px] font-bold">Gérer mon espace moi-même</div>
              <div className="mt-1 text-[12px] text-text-soft">Vous choisissez votre offre et réglez directement.</div>
            </button>
            <button
              type="button"
              onClick={() => patch({ playerAffiliation: "join_club" })}
              className={cn(
                "rounded-xl border p-3.5 text-left transition-colors duration-sv",
                state.playerAffiliation === "join_club"
                  ? "border-brand-blue bg-info-bg"
                  : "border-border hover:border-border-strong",
              )}
            >
              <div className="text-[13px] font-bold">Rejoindre un club sur Connect</div>
              <div className="mt-1 text-[12px] text-text-soft">Votre accès est financé par votre club, sans paiement.</div>
            </button>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button disabled={!canContinue} onClick={() => router.push("/signup/account")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
