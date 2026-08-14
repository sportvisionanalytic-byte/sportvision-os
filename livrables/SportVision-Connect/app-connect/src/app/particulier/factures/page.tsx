import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { FacturesView } from "@/app/factures/FacturesView";

// Factures & paiements (Espace particulier) — réutilise FacturesView TEL QUEL (Espace joueur) en
// mode multi:true : factures rattachées au payeur (README § Listes multi-sportifs — "factures
// rattachées au payeur"), donc uniquement celles où l'appelant a le droit "factures".
export default async function FacturesParticulierPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <FacturesView multi commandeHref="/particulier/commandes" />
    </ParticularShell>
  );
}
