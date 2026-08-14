import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
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
      <CommandesParticulierView athletes={athletes} initialSportif={sportif || null} />
    </ParticularShell>
  );
}
