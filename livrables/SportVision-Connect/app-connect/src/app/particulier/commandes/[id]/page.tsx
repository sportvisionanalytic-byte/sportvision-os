import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { CommandeDetailView } from "@/app/commandes/[id]/CommandeDetailView";

// Fiche commande (Espace particulier) — réutilise CommandeDetailView TEL QUEL (Espace joueur),
// en mode multi:true (voir son en-tête) pour retrouver la commande parmi tous les bénéficiaires
// accessibles, pas seulement le compte de l'appelant.
export default async function CommandeDetailParticulierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";
  const athletes = await fetchMyAthletes(supabase).catch(() => []);

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <CommandeDetailView id={id} multi backHref="/particulier/commandes" />
    </ParticularShell>
  );
}
