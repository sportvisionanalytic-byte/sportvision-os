import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { ManagedAthleteForm } from "./ManagedAthleteForm";

// Profil géré — voie (b), README § Ajouter un sportif. Concept entièrement nouveau (table
// managed_athlete_profiles, migration-connect-v51-espace-particulier.sql §2) : AUCUNE
// vérification de qualité de responsable légal n'est faite ici (le brief l'interdit
// explicitement) — seulement l'avertissement UI ci-dessous, voir le rapport final pour la
// décision produit non tranchée qui en découle.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function ManagedAthletePage() {
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  return <ManagedAthleteForm />;
}
