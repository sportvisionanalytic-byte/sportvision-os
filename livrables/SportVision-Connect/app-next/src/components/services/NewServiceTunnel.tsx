"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepIndicator } from "./tunnel/StepIndicator";
import { Step1Type } from "./tunnel/Step1Type";
import { Step2Details } from "./tunnel/Step2Details";
import { Step3Options } from "./tunnel/Step3Options";
import { Step4Pricing } from "./tunnel/Step4Pricing";
import { Step5Summary } from "./tunnel/Step5Summary";
import { INITIAL_TUNNEL_STATE, TUNNEL_STEPS, type TunnelState } from "./tunnel/types";

// Tunnel de demande de prestation — 5 étapes, voir ACTIONS.md § 12. Aucune requête serveur :
// la soumission finale renvoie vers /services (voir app-next/README.md § Décision volontairement
// pas prise ici — pas de backend branché).
export function NewServiceTunnel() {
  const router = useRouter();
  const { ctx } = useSession();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<TunnelState>(INITIAL_TUNNEL_STATE);
  const [submitted, setSubmitted] = useState(false);

  function patch(update: Partial<TunnelState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  const canContinue = (() => {
    switch (step) {
      case 1:
        return !!state.serviceType;
      case 2:
        return !!(state.date && state.startTime && state.endTime && state.address && state.contactName && state.contactPhone);
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return state.acceptedTerms;
      default:
        return false;
    }
  })();

  function handleSubmit() {
    setSubmitted(true);
    // Pas de backend branché : la demande est simulée, l'utilisateur retrouve le kanban où sa
    // prestation apparaîtrait en colonne « Demande reçue » une fois la couche de données réelle
    // branchée. Voir séquences serveur DATA_MODEL.md.
    setTimeout(() => router.push("/services"), 900);
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
        {step === 1 && <Step1Type value={state.serviceType} onChange={(serviceType) => patch({ serviceType })} />}
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
            planCode={ctx.subscription.planCode}
            organizationAddress={ctx.organization.address}
            onChangeDepositMethod={(depositMethod) => patch({ depositMethod })}
          />
        )}
        {step === 5 && (
          <Step5Summary
            state={state}
            planCode={ctx.subscription.planCode}
            organizationAddress={ctx.organization.address}
            onAcceptTermsChange={(acceptedTerms) => patch({ acceptedTerms })}
          />
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
          Retour
        </Button>
        {step < TUNNEL_STEPS.length ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continuer
          </Button>
        ) : (
          <Button variant="primary" onClick={handleSubmit} disabled={!canContinue}>
            Envoyer ma demande
          </Button>
        )}
      </div>
    </div>
  );
}
