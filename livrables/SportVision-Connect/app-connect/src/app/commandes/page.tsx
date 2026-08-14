import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { CommandesView } from "./CommandesView";

// Mes commandes — voir design-connect-personnel-12-08/README.md § Espace joueur → Mes
// commandes. Données via l'edge function connect-player-prestations (action "list_orders") —
// voir son commentaire d'en-tête pour la raison (les vues client_prestations existantes ne
// couvrent pas encore un compte joueur).
export default async function CommandesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <Suspense fallback={<div className="h-[92px] animate-pulse rounded-sv-card border border-border bg-surface" />}>
        <CommandesView />
      </Suspense>
    </AppShell>
  );
}
