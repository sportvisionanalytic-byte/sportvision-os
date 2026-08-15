import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { CommandesParticulierView } from "./CommandesParticulierView";

// Mes commandes (Espace particulier) — voir design-connect-personnel-12-08/README.md § Listes
// multi-sportifs. Données via connect-player-prestations en mode multi (action "list_orders",
// multi:true) : agrège les commandes accessibles (soi-même + sportifs liés avec le droit
// "commandes" + profils gérés), chacune taguée "Pour X" côté serveur.
export default async function CommandesParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ sportif?: string }>;
}) {
  const { sportif } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player et athletes sont indépendants (aucun n'a besoin du résultat de l'autre) — voir
  // rapport fluidité perçue 15/08.
  const [player, athletes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <CommandesParticulierView athletes={athletes} initialSportif={sportif || null} />
    </ParticularShell>
  );
}
