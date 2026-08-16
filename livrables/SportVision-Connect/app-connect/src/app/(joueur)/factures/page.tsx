import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { FacturesView } from "./FacturesView";

// Factures & paiements — voir design-connect-personnel-12-08/README.md § Espace joueur →
// Factures & paiements. Données via l'edge function connect-player-prestations (actions
// "list_invoices"/"list_payments") — voir son commentaire d'en-tête.
//
// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function FacturesPage() {
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

  return <FacturesView />;
}
