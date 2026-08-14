import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { FacturesView } from "./FacturesView";

// Factures & paiements — voir design-connect-personnel-12-08/README.md § Espace joueur →
// Factures & paiements. Données via l'edge function connect-player-prestations (actions
// "list_invoices"/"list_payments") — voir son commentaire d'en-tête.
export default async function FacturesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <FacturesView />
    </AppShell>
  );
}
