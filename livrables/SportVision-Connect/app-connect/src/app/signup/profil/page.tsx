"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PROFILES, useSignup } from "../signup-context";

// Étape 2 · Profil — choix purement descriptif, aucun privilège (voir README design § Profil).
export default function SignupProfilePage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  useEffect(() => {
    if (!state.firstName.trim() || !state.email.trim()) router.replace("/signup");
  }, [state.firstName, state.email, router]);

  const canContinue = state.profile !== null && (state.profile !== "autre" || state.otherProfile.trim());

  function handleContinue() {
    if (!canContinue) return;
    router.push("/signup/sport");
  }

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[31px] font-bold tracking-tight">Comment allez-vous utiliser Connect ?</h1>
        <p className="text-[15px] text-text-tertiary">Cela nous permet simplement de personnaliser votre espace.</p>
      </div>

      <div className="flex flex-col gap-3">
        {PROFILES.map((p) => {
          const selected = state.profile === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => patch({ profile: p.id })}
              className={`flex min-h-[76px] items-center gap-3.5 rounded-sv-card border p-4 text-left transition-colors duration-150 ${
                selected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
              }`}
            >
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-white/5">
                <span className="material-symbols-rounded !text-[24px] text-[#8CA9FF]" aria-hidden="true">{p.icon}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-sora text-[16px] font-semibold text-text">{p.label}</span>
                <span className="text-[13px] leading-snug text-text-tertiary">{p.sub}</span>
              </span>
              {selected && (
                <span className="material-symbols-rounded filled ml-auto !text-[22px] text-affiliations" aria-hidden="true">
                  check_circle
                </span>
              )}
            </button>
          );
        })}
      </div>

      {state.profile === "autre" && (
        <Field
          id="su-other"
          label="Précisez votre profil"
          placeholder="Entraîneur individuel, arbitre, journaliste…"
          value={state.otherProfile}
          onChange={(e) => patch({ otherProfile: e.target.value })}
        />
      )}

      <Button onClick={handleContinue} disabled={!canContinue} className="w-full">
        Continuer
      </Button>
    </div>
  );
}
