import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { FacturesView } from "@/app/(joueur)/factures/FacturesView";

// Factures & paiements (Espace particulier) — réutilise FacturesView TEL QUEL (Espace joueur) en
// mode multi:true : factures rattachées au payeur (README § Listes multi-sportifs — "factures
// rattachées au payeur"), donc uniquement celles où l'appelant a le droit "factures".
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function FacturesParticulierPage() {
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  return <FacturesView multi commandeHref="/particulier/commandes" />;
}
