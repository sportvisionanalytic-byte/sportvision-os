"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { resetOnboardingProgress } from "@/components/onboarding/onboarding-storage";
import { useSignup } from "../signup-context";

// Étape 7 · Confirmation — voir ACTIONS.md § 2.
//
// 09/08/2026 — n'affirme plus jamais "votre espace est prêt" par défaut : le résultat réel
// dépend de ce que checkout/page.tsx a effectivement réussi à faire (voir `outcome` dans
// l'URL, posé juste après l'appel serveur, jamais deviné depuis l'état du formulaire) :
//  - confirm_email : compte créé, mais la confirmation d'e-mail Supabase est active sur ce
//    projet — aucune organisation n'a encore pu être créée, ça se fera au premier login.
//  - org_created : organisation + accès réels créés (coach/académie, structure générique,
//    événement).
//  - lead : compte créé, mais cette demande nécessite un suivi manuel par un conseiller
//    (offre Club/Académie sans facturation automatique, devis Full Communication) — pas
//    d'espace à afficher tout de suite.
export default function SignupDonePage() {
  return (
    <Suspense fallback={null}>
      <SignupDoneContent />
    </Suspense>
  );
}

function SignupDoneContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state } = useSignup();
  const outcome = searchParams.get("outcome");

  const isFullCom = state.planCode === "full_communication";

  function goToDashboard() {
    resetOnboardingProgress();
    router.push("/dashboard");
  }

  function goToLogin() {
    router.push("/auth/login");
  }

  if (outcome === "confirm_email") {
    return (
      <div className="flex flex-col items-center gap-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-info-bg text-brand-blue-electric">
          <Mail className="h-8 w-8" aria-hidden />
        </span>
        <div className="max-w-md">
          <h1 className="text-[26px] font-extrabold tracking-tight">Confirmez votre adresse e-mail</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
            Votre compte a été créé. Cliquez sur le lien reçu par e-mail à <strong className="text-text">{state.account.email}</strong>,
            puis connectez-vous : {isFullCom || (state.orgType === "club" && state.planCode !== "club_plus_start" && state.planCode !== "club_plus_performance")
              ? "un conseiller SportVision finalisera votre demande."
              : "votre espace se termine de configurer automatiquement à ce moment-là."}
          </p>
        </div>
        <Button onClick={goToLogin} className="mt-2">
          Aller à la connexion
        </Button>
      </div>
    );
  }

  if (outcome === "lead") {
    return (
      <div className="flex flex-col items-center gap-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg">
          <CheckCircle2 className="h-8 w-8" aria-hidden />
        </span>
        <div className="max-w-md">
          <h1 className="text-[26px] font-extrabold tracking-tight">
            {isFullCom ? "Votre demande de devis est en route" : "Votre demande a bien été reçue"}
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
            {isFullCom
              ? "Un conseiller SportVision vous recontacte sous 24h ouvrées pour construire votre accompagnement sur mesure."
              : "Votre compte est créé. Un conseiller SportVision vous contacte pour finaliser votre offre — elle n'est pas encore active."}
          </p>
        </div>
        <Button onClick={goToLogin} className="mt-2">
          Aller à la connexion
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg">
        <CheckCircle2 className="h-8 w-8" aria-hidden />
      </span>
      <div className="max-w-md">
        <h1 className="text-[26px] font-extrabold tracking-tight">Votre espace est prêt</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
          Votre compte et votre organisation sont configurés. Vous pouvez accéder à votre espace dès maintenant.
        </p>
      </div>
      <Button onClick={goToDashboard} className="mt-2">
        Accéder à mon espace
      </Button>
    </div>
  );
}
