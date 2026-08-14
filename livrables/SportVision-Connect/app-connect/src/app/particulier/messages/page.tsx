import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { MessagesParticulierView } from "./MessagesParticulierView";

// Messages contextualisés — voir design-connect-personnel-12-08/README.md § Messages
// contextualisées : sélecteur "Ce message concerne : Mon compte / [Sportif A] / [Sportif B]".
// Chaque contexte a son propre client_id/fil messages_client — voir migration-connect-v51-
// espace-particulier.sql §9 pour l'extension RLS qui rend ceci possible (un particulier ne
// pouvait, avant cette migration, lire/écrire QUE son propre fil).
export default async function MessagesParticulierPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = (await fetchMyAthletes(supabase).catch(() => [])).filter((a) => a.rights.voir);

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <MessagesParticulierView firstName={firstName} athletes={athletes} />
    </ParticularShell>
  );
}
