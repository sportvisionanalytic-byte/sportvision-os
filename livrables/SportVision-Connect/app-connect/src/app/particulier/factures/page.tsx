import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { FacturesView } from "@/app/factures/FacturesView";

// Factures & paiements (Espace particulier) — réutilise FacturesView TEL QUEL (Espace joueur) en
// mode multi:true : factures rattachées au payeur (README § Listes multi-sportifs — "factures
// rattachées au payeur"), donc uniquement celles où l'appelant a le droit "factures".
export default async function FacturesParticulierPage() {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player et athletes sont indépendants — voir rapport fluidité perçue 15/08.
  const [player, athletes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <FacturesView multi commandeHref="/particulier/commandes" />
    </ParticularShell>
  );
}
