import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { fetchPlayerCatalogue } from "@/lib/prestations/catalogue";
import { PrestationsParticulierView } from "./PrestationsParticulierView";

// Prestations (Espace particulier) — voir design-connect-personnel-12-08/README.md § Espace
// particulier → Réservation pour un sportif. Fidèle au prototype de référence : contrairement à
// l'Espace joueur, les cartes du catalogue mènent DIRECTEMENT au wizard de réservation (pas de
// fiche produit marketing intermédiaire) — le sélecteur "Pour qui réservez-vous ?" est affiché
// avant le catalogue, exactement comme dans Connect Espace Particulier.dc.html.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page garde son propre fetch de firstName/athletes car PrestationsParticulierView en a besoin.
export default async function PrestationsParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ benefKind?: string; benefId?: string }>;
}) {
  const { benefKind, benefId } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et offers sont indépendants — voir rapport fluidité perçue 15/08.
  const [player, athletes, offers] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    fetchPlayerCatalogue(supabase),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <PrestationsParticulierView
      firstName={firstName}
      athletes={athletes}
      offers={offers}
      initialBenefKind={benefKind === "linked" || benefKind === "managed" ? benefKind : "self"}
      initialBenefId={benefId || null}
    />
  );
}
