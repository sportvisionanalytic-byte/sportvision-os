import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { ManagedAthleteForm } from "./ManagedAthleteForm";

// Profil géré — voie (b), README § Ajouter un sportif. Concept entièrement nouveau (table
// managed_athlete_profiles, migration-connect-v51-espace-particulier.sql §2) : AUCUNE
// vérification de qualité de responsable légal n'est faite ici (le brief l'interdit
// explicitement) — seulement l'avertissement UI ci-dessous, voir le rapport final pour la
// décision produit non tranchée qui en découle.
export default async function ManagedAthletePage() {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <ManagedAthleteForm />
    </ParticularShell>
  );
}
