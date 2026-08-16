import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { CommandesParticulierView } from "./CommandesParticulierView";

// Mes commandes (Espace particulier) — voir design-connect-personnel-12-08/README.md § Listes
// multi-sportifs. Données via connect-player-prestations en mode multi (action "list_orders",
// multi:true) : agrège les commandes accessibles (soi-même + sportifs liés avec le droit
// "commandes" + profils gérés), chacune taguée "Pour X" côté serveur.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page garde son propre fetch d'athletes car CommandesParticulierView en a besoin pour son
// propre filtre "Pour qui".
export default async function CommandesParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ sportif?: string }>;
}) {
  const { sportif } = await searchParams;
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  return <CommandesParticulierView athletes={athletes} initialSportif={sportif || null} />;
}
