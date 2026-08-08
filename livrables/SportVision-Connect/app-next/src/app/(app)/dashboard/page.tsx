"use client";

import { useSession } from "@/lib/session-context";
import { ClubPlusDashboard } from "@/components/dashboard/ClubPlusDashboard";
import { FullCommunicationDashboard } from "@/components/dashboard/FullCommunicationDashboard";
import { PersonaDashboard } from "@/components/dashboard/PersonaDashboard";
import { OnboardingOverlay } from "@/components/onboarding/OnboardingOverlay";

// Aiguilleur — le tableau de bord n'a qu'une seule route mais trois familles de contenu très
// différentes. Chaque variante vit dans son propre fichier sous src/components/dashboard/ pour
// que plusieurs personnes puissent les construire en parallèle sans jamais éditer ce fichier.
// N'ajoutez pas de logique ici : créez/complétez la variante concernée.
//
// `OnboardingOverlay` (voir ACTIONS.md § 3) est monté ici par exception explicite du périmètre
// Inscription/Onboarding/... : c'est le seul point d'insertion autorisé pour cet écran modal
// affiché par-dessus le tableau de bord après la première connexion. La logique d'aiguillage
// ci-dessous (quelle variante de dashboard afficher) n'est pas modifiée, seulement restructurée
// en une expression unique pour pouvoir envelopper le résultat dans un fragment.
export default function DashboardPage() {
  const { ctx } = useSession();

  const dashboard =
    ctx.subscription.planCode === "full_communication" ? (
      <FullCommunicationDashboard />
    ) : ctx.organization.type !== "club" ? (
      <PersonaDashboard />
    ) : (
      <ClubPlusDashboard />
    );

  return (
    <>
      <OnboardingOverlay />
      {dashboard}
    </>
  );
}
