"use client";

import { useSession } from "@/lib/session-context";
import { ClubPlusDashboard } from "@/components/dashboard/ClubPlusDashboard";
import { FullCommunicationDashboard } from "@/components/dashboard/FullCommunicationDashboard";
import { PersonaDashboard } from "@/components/dashboard/PersonaDashboard";

// Aiguilleur — le tableau de bord n'a qu'une seule route mais trois familles de contenu très
// différentes. Chaque variante vit dans son propre fichier sous src/components/dashboard/ pour
// que plusieurs personnes puissent les construire en parallèle sans jamais éditer ce fichier.
// N'ajoutez pas de logique ici : créez/complétez la variante concernée.
export default function DashboardPage() {
  const { ctx } = useSession();

  if (ctx.subscription.planCode === "full_communication") return <FullCommunicationDashboard />;
  if (ctx.organization.type !== "club") return <PersonaDashboard />;
  return <ClubPlusDashboard />;
}
