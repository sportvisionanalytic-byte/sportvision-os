"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { cn } from "@/lib/cn";
import { PLAN_OPTIONS_BY_TYPE, useSignup } from "../signup-context";
import { inputClass } from "../signup-styles";

const ENGAGEMENT_PLANS = new Set(["club_plus_start", "club_plus_performance"]);

// Étape 5 · Offre — voir ACTIONS.md § 2. Cartes radio filtrées par type. Un joueur affilié saisit
// le nom de son club en texte libre : aucune recherche en direct n'est branchée (aucune policy de
// lecture publique sur `organizations` à ce jour), un conseiller SportVision retrouve et valide le
// club manuellement — voir le commentaire clubSearch dans signup-context.tsx.
export default function SignupPlanPage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  const isAffiliatedPlayer = state.orgType === "player" && state.playerAffiliation === "join_club";
  const availablePlans = useMemo(
    () => (state.orgType ? PLAN_OPTIONS_BY_TYPE[state.orgType].map((code) => PLANS[code]) : []),
    [state.orgType],
  );
  const selectedPlan = state.planCode ? PLANS[state.planCode] : null;
  const needsEngagementChoice = selectedPlan !== null && ENGAGEMENT_PLANS.has(selectedPlan.code);

  const canContinue = isAffiliatedPlayer ? state.clubSearch.trim().length > 0 : state.planCode !== null;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">
          {isAffiliatedPlayer ? "Recherchez votre club" : "Choisissez votre offre"}
        </h1>
        <p className="mt-2 text-[14px] text-text-soft">
          {isAffiliatedPlayer
            ? "Votre accès sera financé par le club une fois votre demande validée par un administrateur."
            : "Vous pourrez toujours en changer plus tard depuis vos paramètres."}
        </p>
      </div>

      {isAffiliatedPlayer ? (
        <div className="flex flex-col gap-2 max-w-md">
          <input
            value={state.clubSearch}
            onChange={(e) => patch({ clubSearch: e.target.value })}
            className={inputClass}
            placeholder="Nom du club"
          />
          <p className="text-[12px] text-text-soft">
            Un conseiller SportVision vérifie et rattache votre compte à ce club sous 24 à 48h ouvrées.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {availablePlans.map((plan) => {
              const selected = state.planCode === plan.code;
              return (
                <button
                  key={plan.code}
                  type="button"
                  onClick={() => patch({ planCode: plan.code })}
                  className={cn(
                    "flex flex-col items-start gap-2.5 rounded-sv-card border p-4 text-left transition-[transform,border-color] duration-sv hover:-translate-y-0.5",
                    selected ? "border-brand-blue bg-info-bg shadow-sv-card-hover" : "border-border bg-surface",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="text-[16px] font-extrabold tracking-tight">{plan.name}</span>
                    {selected && (
                      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-blue text-white">
                        <Check className="h-3 w-3" aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] font-bold text-brand-blue-electric">{formatPlanPrice(plan)}</span>
                  <span className="text-[12px] text-text-soft">
                    {formatPlanCredits(plan)} · {plan.maxUsers === null ? "Utilisateurs illimités" : `${plan.maxUsers} utilisateurs`}
                  </span>
                </button>
              );
            })}
          </div>

          {needsEngagementChoice && selectedPlan && (
            <div className="flex flex-col gap-2 rounded-sv-card border border-border bg-surface-alt p-4">
              <span className="text-[13px] font-extrabold tracking-tight">Engagement</span>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => patch({ engagement: "12mois" })}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors duration-sv",
                    state.engagement === "12mois" ? "border-brand-blue-electric bg-info-bg" : "border-border-strong bg-surface",
                  )}
                >
                  <div className="text-[13px] font-extrabold tracking-tight">Engagement 12 mois</div>
                  <div className="mt-0.5 text-[12px] text-text-soft">{selectedPlan.monthlyPrice} € / mois</div>
                </button>
                <button
                  type="button"
                  onClick={() => patch({ engagement: "sans" })}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors duration-sv",
                    state.engagement === "sans" ? "border-brand-blue-electric bg-info-bg" : "border-border-strong bg-surface",
                  )}
                >
                  <div className="text-[13px] font-extrabold tracking-tight">Sans engagement</div>
                  <div className="mt-0.5 text-[12px] text-text-soft">{selectedPlan.monthlyPriceNoCommitment} € / mois</div>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/needs")}>
          Retour
        </Button>
        <Button disabled={!canContinue} onClick={() => router.push("/signup/checkout")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
