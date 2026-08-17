"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { ORG_TYPE_OPTIONS, useSignup } from "../signup-context";

// Étape 1 · Structure — voir ACTIONS.md § 2.
//
// 17/08/2026 — plus d'option "Joueur" ici : ce persona vit exclusivement sur SportVision Connect
// (voir HANDOFF-CLUBPLUS.md § 1), jamais sur Club+. L'ancien chemin "Joueur affilié à un club"
// (recherche de club + rattachement) a été entièrement retiré de ce tunnel.
export default function SignupTypePage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  const canContinue = state.orgType !== null;

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
              onClick={() => patch({ orgType: option.type })}
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

      <div className="flex justify-end">
        {/* Un club ne traverse plus le tunnel standard (compte + club actif immédiat) : voir
            /signup/club-request/*, 4 étapes, sans mot de passe, qui aboutit à une demande
            transmise au staff pour validation manuelle — jamais un club actif + admin créés
            directement depuis une inscription publique (faille corrigée le 12/08/2026,
            migration-connect-v44-club-signup-requests.sql). */}
        <Button
          disabled={!canContinue}
          onClick={() => router.push(state.orgType === "club" ? "/signup/club-request" : "/signup/account")}
        >
          Continuer
        </Button>
      </div>
    </div>
  );
}
