"use client";

import { useSession } from "@/lib/session-context";

// STUB — à remplacer par l'implémentation réelle. Couvre les tableaux de bord Joueur, Parent,
// Sponsor, CM externe, Client ponctuel et Structure générique — voir ACTIONS.md § 5
// « Joueur, Parent, CM externe, Client ponctuel » et § 20 bis / 20 ter. Même ossature pour
// tous : bandeau héros contextuel, 3 jauges, liste prioritaire, liste secondaire, derniers
// contenus — le contenu varie, pas le composant.
export function PersonaDashboard() {
  const { ctx } = useSession();
  return (
    <div className="rounded-sv-card border border-dashed border-border-strong p-8 text-center text-text-soft">
      Tableau de bord {ctx.organization.type} — {ctx.organization.name} (à construire, voir ACTIONS.md § 5)
    </div>
  );
}
