import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { fetchPlayerCatalogue } from "@/lib/prestations/catalogue";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { PrestationsParticulierView } from "./PrestationsParticulierView";

// Prestations (Espace particulier) — voir design-connect-personnel-12-08/README.md § Espace
// particulier → Réservation pour un sportif. Fidèle au prototype de référence : contrairement à
// l'Espace joueur, les cartes du catalogue mènent DIRECTEMENT au wizard de réservation (pas de
// fiche produit marketing intermédiaire) — le sélecteur "Pour qui réservez-vous ?" est affiché
// avant le catalogue, exactement comme dans Connect Espace Particulier.dc.html.
export default async function PrestationsParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ benefKind?: string; benefId?: string }>;
}) {
  const { benefKind, benefId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  const [athletes, offers] = await Promise.all([fetchMyAthletes(supabase).catch(() => []), fetchPlayerCatalogue(supabase)]);

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <PrestationsParticulierView
        firstName={firstName}
        athletes={athletes}
        offers={offers}
        initialBenefKind={benefKind === "linked" || benefKind === "managed" ? benefKind : "self"}
        initialBenefId={benefId || null}
      />
    </ParticularShell>
  );
}
