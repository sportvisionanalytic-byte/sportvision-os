import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { CommandesView } from "./CommandesView";

// Mes commandes — voir design-connect-personnel-12-08/README.md § Espace joueur → Mes
// commandes. Données via l'edge function connect-player-prestations (action "list_orders") —
// voir son commentaire d'en-tête (les vues client_prestations existantes ne couvrent pas encore
// un compte joueur).
//
// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function CommandesPage() {
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

  return (
    <Suspense fallback={<div className="h-[92px] animate-pulse rounded-sv-card border border-border bg-surface" />}>
      <CommandesView />
    </Suspense>
  );
}
