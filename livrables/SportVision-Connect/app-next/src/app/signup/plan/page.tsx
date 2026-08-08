"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { mockOrganizations } from "@/lib/mock-data";
import { cn } from "@/lib/cn";
import { PLAN_OPTIONS_BY_TYPE, useSignup } from "../signup-context";
import { inputClass } from "../signup-styles";

// Étape 5 · Offre — voir ACTIONS.md § 2. Cartes radio filtrées par type. Un joueur affilié voit
// une recherche de club à la place (accès financé par le club, voir DATA_MODEL.md § Organization).
export default function SignupPlanPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const [clubQuery, setClubQuery] = useState(state.clubSearch);

  const isAffiliatedPlayer = state.orgType === "player" && state.playerAffiliation === "join_club";
  const availablePlans = useMemo(
    () => (state.orgType ? PLAN_OPTIONS_BY_TYPE[state.orgType].map((code) => PLANS[code]) : []),
    [state.orgType],
  );

  const clubResults = useMemo(() => {
    if (!clubQuery.trim()) return [];
    return mockOrganizations.filter(
      (o) => o.type === "club" && o.name.toLowerCase().includes(clubQuery.trim().toLowerCase()),
    );
  }, [clubQuery]);

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
        <div className="flex flex-col gap-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
            <input
              value={clubQuery}
              onChange={(e) => {
                setClubQuery(e.target.value);
                patch({ clubSearch: e.target.value });
              }}
              className={cn(inputClass, "pl-9")}
              placeholder="Rechercher un club sur Connect…"
            />
          </div>
          {clubResults.length > 0 && (
            <Card className="max-w-md divide-y divide-divider">
              {clubResults.map((club) => (
                <button
                  key={club.id}
                  type="button"
                  onClick={() => {
                    setClubQuery(club.name);
                    patch({ clubSearch: club.name });
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-semibold hover:bg-row-hover"
                >
                  {club.name}
                  {state.clubSearch === club.name && <Check className="h-4 w-4 text-brand-blue" aria-hidden />}
                </button>
              ))}
            </Card>
          )}
        </div>
      ) : (
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
