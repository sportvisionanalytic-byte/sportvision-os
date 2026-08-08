"use client";

import { useSession } from "@/lib/session-context";

// STUB — à remplacer par l'implémentation réelle. Voir ACTIONS.md § 5 « Full Communication »
// et § 9 pour le détail des écrans liés (validations, publications, présences, analytics,
// rapports, mon CM). Le titre et le contenu varient par type d'organisation (club, coach,
// académie, événement) — voir README.md § Les treize expériences.
export function FullCommunicationDashboard() {
  const { ctx } = useSession();
  return (
    <div className="rounded-sv-card border border-dashed border-border-strong p-8 text-center text-text-soft">
      Tableau de bord Full Communication — {ctx.organization.name} (à construire, voir ACTIONS.md § 5)
    </div>
  );
}
