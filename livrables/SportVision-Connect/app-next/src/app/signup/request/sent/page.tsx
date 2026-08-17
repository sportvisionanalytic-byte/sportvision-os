"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSignup } from "../../signup-context";

// Écran de succès (master prompt §42-45) — hors frise de progression (§2), volontairement PAS
// "Bienvenue" ni un dashboard : aucun compte ni structure n'a été créé, seulement une demande en
// attente de vérification SportVision.
export default function RequestSentPage() {
  return (
    <Suspense fallback={null}>
      <RequestSentContent />
    </Suspense>
  );
}

function RequestSentContent() {
  const router = useRouter();
  const { state } = useSignup();
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg">
        <CheckCircle2 className="h-8 w-8" aria-hidden />
      </span>

      <div className="max-w-md">
        <h1 className="text-[26px] font-extrabold tracking-tight">Demande envoyée ✓</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
          Votre demande d&apos;ouverture Club+ {state.nom ? <>pour <strong className="text-text">{state.nom}</strong></> : ""} a
          bien été transmise à SportVision.
        </p>
        {ref && <p className="mt-2 text-[12.5px] font-semibold text-text-faint">Référence : {ref}</p>}
      </div>

      <div className="w-full max-w-md rounded-xl border border-border-strong bg-surface-alt p-4 text-left text-[13px] text-text-soft">
        <div className="font-extrabold text-text">Que se passe-t-il maintenant ?</div>
        <ul className="mt-2.5 flex flex-col gap-1.5 leading-relaxed">
          <li>SportVision va vérifier les informations transmises.</li>
          <li>Vous recevrez un e-mail lorsque votre demande aura été examinée.</li>
          <li>Si elle est validée, un lien sécurisé vous permettra d&apos;activer votre accès Club+.</li>
        </ul>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Button onClick={() => (window.location.href = "https://sportvision-an.fr")}>Retour au site SportVision</Button>
        <Button variant="secondary" onClick={() => router.push("/auth/login")}>
          Se connecter
        </Button>
      </div>
    </div>
  );
}
