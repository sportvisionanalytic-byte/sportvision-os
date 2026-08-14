import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { InviteAthleteForm } from "./InviteAthleteForm";

// Inviter un sportif — réutilise le système "Accès à mon profil" déjà construit côté Espace
// joueur : table connect_access_relationships + RPC connect_request_profile_access (déjà en
// base, migration-connect-personnel-accueil-profil-acces.sql). Le particulier appelle ici
// EXACTEMENT la même RPC que si l'inverse se produisait (un joueur demandant accès à un autre
// profil) — aucune nouvelle primitive nécessaire, seulement un nouveau point d'entrée UI, comme
// demandé par la mission.
export default async function InviteAthletePage() {
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
      <InviteAthleteForm />
    </ParticularShell>
  );
}
