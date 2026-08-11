"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { fetchCatalogueOffres, submitClientService } from "@/lib/data/projet/services";
import { needsRetractationWaiver, type CatalogueOffer } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepIndicator } from "./tunnel/StepIndicator";
import { Step1Type } from "./tunnel/Step1Type";
import { Step2Details } from "./tunnel/Step2Details";
import { Step3Options } from "./tunnel/Step3Options";
import { Step4Pricing } from "./tunnel/Step4Pricing";
import { Step5Summary } from "./tunnel/Step5Summary";
import { INITIAL_TUNNEL_STATE, TUNNEL_STEPS, type TunnelState } from "./tunnel/types";

// Tunnel de demande de prestation — 5 étapes, voir ACTIONS.md § 12. Espace Projet uniquement
// (organization.type === "generic", voir services/new/page.tsx) : la soumission finale fait un
// vrai INSERT dans `prestations` via lib/data/projet/services.ts:submitClientService, autorisé
// par la policy RLS "prestations_client_insert" (migration-portail-v2.sql). Notification staff
// automatique via le trigger trg_prestations_notify_demande (migration-portail-v10.sql).
//
// Étape 1 sur le vrai catalogue (catalogue_offres) depuis le 11/08/2026 — décision Fouka de ne
// plus avoir de grille de prix séparée et inventée pour l'Espace Projet, voir
// lib/types/services.ts § CatalogueOffer.
export function NewServiceTunnel() {
  const router = useRouter();
  const { ctx } = useSession();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<TunnelState>(INITIAL_TUNNEL_STATE);
  const [offers, setOffers] = useState<CatalogueOffer[] | null>(null);
  const [offersError, setOffersError] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogueOffres(createClient())
      .then((rows) => {
        if (!cancelled) setOffers(rows);
      })
      .catch(() => {
        if (!cancelled) setOffersError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOffer = offers?.find((o) => o.id === state.offerId) ?? null;

  function patch(update: Partial<TunnelState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  const canContinue = (() => {
    switch (step) {
      case 1:
        return !!state.offerId;
      case 2:
        return !!(state.date && state.startTime && state.endTime && state.address && state.contactName && state.contactPhone);
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return state.acceptedTerms && (!needsRetractationWaiver(state.date) || state.retractationRenoncee);
      default:
        return false;
    }
  })();

  async function handleSubmit() {
    if (!selectedOffer || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const supabase = createClient();
      await submitClientService(supabase, ctx.organization.id, {
        offer: selectedOffer,
        date: state.date,
        startTime: state.startTime,
        endTime: state.endTime,
        address: state.address,
        teamLabel: state.teamLabel,
        contactName: state.contactName,
        contactPhone: state.contactPhone,
        needs: state.needs,
        optionCodes: state.optionCodes,
        retractationRenoncee: state.retractationRenoncee,
      });
      setSubmitted(true);
      setTimeout(() => router.push("/services"), 900);
    } catch {
      setSubmitError("Impossible d'envoyer votre demande pour le moment. Réessayez dans quelques instants.");
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="mx-auto flex max-w-[480px] flex-col items-center gap-3 p-9 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-fg text-[22px] font-extrabold">
          ✓
        </span>
        <h1 className="text-[19px] font-extrabold tracking-tight">Votre demande a bien été envoyée</h1>
        <p className="text-[13.5px] leading-relaxed text-text-soft">
          Votre interlocuteur SportVision va l&apos;étudier et revient vers vous avec un devis. Redirection vers vos
          prestations…
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Retour aux prestations"
          onClick={() => router.push("/services")}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Nouvelle demande de prestation</h1>
        </div>
      </div>

      <StepIndicator current={step} />

      <Card className="p-6">
        {offersError ? (
          <p className="py-8 text-center text-[13px] text-danger-fg">
            Impossible de charger le catalogue pour le moment. Réessayez dans quelques instants.
          </p>
        ) : (
          <>
            {step === 1 && <Step1Type offers={offers ?? []} value={state.offerId} onChange={(offerId) => patch({ offerId })} />}
            {step === 2 && <Step2Details state={state} onChange={patch} />}
            {step === 3 && (
              <Step3Options
                selected={state.optionCodes}
                onToggle={(code) =>
                  patch({
                    optionCodes: state.optionCodes.includes(code)
                      ? state.optionCodes.filter((c) => c !== code)
                      : [...state.optionCodes, code],
                  })
                }
              />
            )}
            {step === 4 && (
              <Step4Pricing
                state={state}
                offer={selectedOffer}
                planCode={ctx.subscription.planCode}
                organizationAddress={ctx.organization.address}
              />
            )}
            {step === 5 && (
              <Step5Summary
                state={state}
                offer={selectedOffer}
                planCode={ctx.subscription.planCode}
                organizationAddress={ctx.organization.address}
                onAcceptTermsChange={(acceptedTerms) => patch({ acceptedTerms })}
                onRetractationRenonceeChange={(retractationRenoncee) => patch({ retractationRenoncee })}
              />
            )}
          </>
        )}
      </Card>

      {submitError && (
        <p className="rounded-xl border border-danger-fg/30 bg-danger-bg px-4 py-3 text-[13px] font-semibold text-danger-fg">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || submitting}>
          Retour
        </Button>
        {step < TUNNEL_STEPS.length ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continuer
          </Button>
        ) : (
          <Button variant="primary" onClick={handleSubmit} disabled={!canContinue || submitting} loading={submitting}>
            Envoyer ma demande
          </Button>
        )}
      </div>
    </div>
  );
}
