"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { resetOnboardingProgress } from "@/components/onboarding/onboarding-storage";
import { useSignup } from "../signup-context";

// Étape 7 · Confirmation — voir ACTIONS.md § 2. « Accéder à mon espace » → onboarding, affiché
// par-dessus le tableau de bord (voir src/components/onboarding/OnboardingOverlay.tsx).
export default function SignupDonePage() {
  const router = useRouter();
  const { state } = useSignup();

  const isAffiliatedPlayer = state.orgType === "player" && state.playerAffiliation === "join_club";
  const isFullCom = state.planCode === "full_communication";

  function goToDashboard() {
    resetOnboardingProgress();
    router.push("/dashboard");
  }

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg">
        <CheckCircle2 className="h-8 w-8" aria-hidden />
      </span>

      <div className="max-w-md">
        <h1 className="text-[26px] font-extrabold tracking-tight">
          {isAffiliatedPlayer
            ? "Votre demande a bien été envoyée"
            : isFullCom
              ? "Votre demande de devis est en route"
              : "Votre espace est prêt"}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
          {isAffiliatedPlayer
            ? `Nous avons transmis votre demande de rattachement à ${state.clubSearch || "votre club"}. Vous serez notifié dès qu'un administrateur l'aura validée.`
            : isFullCom
              ? "Un conseiller SportVision vous recontacte sous 24h ouvrées pour construire votre accompagnement sur mesure."
              : "Votre organisation, votre compte et votre abonnement sont configurés. Un conseiller SportVision vous est déjà assigné."}
        </p>
      </div>

      <Button onClick={goToDashboard} className="mt-2">
        Accéder à mon espace
      </Button>
    </div>
  );
}
