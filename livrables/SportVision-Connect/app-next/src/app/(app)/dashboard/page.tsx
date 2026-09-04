"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { fetchOnboardingProgress } from "@/lib/data/club/onboarding";
import { ClubPlusDashboard } from "@/components/dashboard/ClubPlusDashboard";
import { FullCommunicationDashboard } from "@/components/dashboard/FullCommunicationDashboard";
import { PersonaDashboard } from "@/components/dashboard/PersonaDashboard";
import { PlayerDashboard } from "@/components/dashboard/PlayerDashboard";
import { OnboardingOverlay } from "@/components/onboarding/OnboardingOverlay";
import { StripeReturnBanner } from "@/components/dashboard/StripeReturnBanner";

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
//
// Redirection première connexion (03/09/2026, master prompt Fouka) — un admin de club qui n'a
// jamais ouvert /onboarding atterrit directement dessus au lieu du dashboard générique.
// `ensureOnboardingStarted` (appelé au montage de /onboarding) fait passer statut de `null`/
// "not_started" à "in_progress" dès la première visite : cette redirection ne se déclenche donc
// naturellement qu'à la toute première connexion, sans state supplémentaire à gérer ici. Gardée
// au rôle admin (seul rôle avec canEdit sur /onboarding, voir ce fichier) — un coach/trésorier
// invité ensuite n'est jamais redirigé de force vers un écran qu'il ne peut pas remplir.
export default function DashboardPage() {
  const { ctx } = useSession();
  const router = useRouter();
  const isClubAdmin = ctx.organization.type === "club" && ctx.membership.role === "admin";
  const [checkedOnboarding, setCheckedOnboarding] = useState(!isClubAdmin);

  useEffect(() => {
    if (!isClubAdmin) return;
    fetchOnboardingProgress(createClient(), ctx.organization.id)
      .then((progress) => {
        if (!progress || progress.statut === "not_started") {
          router.replace("/onboarding");
          return;
        }
        setCheckedOnboarding(true);
      })
      .catch(() => setCheckedOnboarding(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id, isClubAdmin]);

  if (!checkedOnboarding) return null;

  const dashboard =
    ctx.subscription.planCode === "full_communication" ? (
      <FullCommunicationDashboard />
    ) : ctx.organization.type === "player" ? (
      <PlayerDashboard />
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
