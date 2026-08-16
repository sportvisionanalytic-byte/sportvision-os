import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { MessagesParticulierView } from "./MessagesParticulierView";

// Messages contextualisés — voir design-connect-personnel-12-08/README.md § Messages
// contextualisées : sélecteur "Ce message concerne : Mon compte / [Sportif A] / [Sportif B]".
// Chaque contexte a son propre client_id/fil messages_client — voir migration-connect-v51-
// espace-particulier.sql §9 pour l'extension RLS qui rend ceci possible (un particulier ne
// pouvait, avant cette migration, lire/écrire QUE son propre fil).
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page garde son propre fetch de firstName/athletes (filtré sur rights.voir) car
// MessagesParticulierView en a besoin pour son propre sélecteur de contexte.
export default async function MessagesParticulierPage() {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = (await fetchMyAthletes(supabase).catch(() => [])).filter((a) => a.rights.voir);

  return <MessagesParticulierView firstName={firstName} athletes={athletes} />;
}
