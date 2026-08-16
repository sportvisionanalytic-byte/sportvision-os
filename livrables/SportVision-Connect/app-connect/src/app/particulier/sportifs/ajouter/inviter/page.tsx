import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { InviteAthleteForm } from "./InviteAthleteForm";

// Inviter un sportif — réutilise le système "Accès à mon profil" déjà construit côté Espace
// joueur : table connect_access_relationships + RPC connect_request_profile_access (déjà en
// base, migration-connect-personnel-accueil-profil-acces.sql). Le particulier appelle ici
// EXACTEMENT la même RPC que si l'inverse se produisait (un joueur demandant accès à un autre
// profil) — aucune nouvelle primitive nécessaire, seulement un nouveau point d'entrée UI, comme
// demandé par la mission.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function InviteAthletePage() {
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  return <InviteAthleteForm />;
}
