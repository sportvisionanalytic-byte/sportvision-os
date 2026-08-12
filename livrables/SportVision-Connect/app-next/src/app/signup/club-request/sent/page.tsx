"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSignup } from "../../signup-context";

// Confirmation — tunnel /signup/club-request/*. Écran honnête, volontairement PAS "Bienvenue"
// ni un dashboard : aucun compte ni club n'a été créé (contrairement à /signup/done, qui gère
// des issues où un compte existe déjà). Brief Fouka du 12/08/2026.
export default function ClubRequestSentPage() {
  const router = useRouter();
  const { state } = useSignup();

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-fg">
        <CheckCircle2 className="h-8 w-8" aria-hidden />
      </span>
      <div className="max-w-md">
        <h1 className="text-[26px] font-extrabold tracking-tight">Votre demande a été transmise</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
          SportVision examine la demande d&apos;ouverture Connect de{" "}
          <strong className="text-text">{state.clubRequest.clubNom || "votre club"}</strong> et vous recontacte sous 24 à
          48h ouvrées à <strong className="text-text">{state.clubRequest.contactEmail || "l'adresse indiquée"}</strong>.
          Aucun compte n&apos;a été créé : vous recevrez un lien d&apos;activation sécurisé une fois la demande validée.
        </p>
      </div>
      {/* Pas "/" (redirige vers /dashboard, protégé — aucun compte n'existe ici) : /auth/login
          directement, cohérent avec le lien "Déjà un compte ?" du header partagé (layout.tsx). */}
      <Button onClick={() => router.push("/auth/login")} className="mt-2">
        Retour à la connexion
      </Button>
    </div>
  );
}
