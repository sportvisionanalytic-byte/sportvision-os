import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { CreateFundingWizard, type OffreOption, type GroupOption, type FundingBeneficiary } from "@/app/cotisations/creer/CreateFundingWizard";

// Cotisation pour un sportif — voir design-connect-personnel-12-08/README.md § Espace
// particulier → Cotisation pour un sportif. Réutilise le backend group_fundings/
// funding_contributions et le composant CreateFundingWizard TELS QUELS (Espace joueur) : seul
// l'ajout du bénéficiaire (résolu ici à partir de ?benefKind&benefId, vérifié à nouveau côté
// serveur par create_group_funding) constitue le nouveau point d'entrée.
export default async function CreerCotisationParticulierPage({
  searchParams,
}: {
  searchParams: Promise<{ groupe?: string; offreId?: string; benefKind?: string; benefId?: string }>;
}) {
  const { groupe, offreId, benefKind, benefId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  const [{ data: offres }, { data: groups }, athletes] = await Promise.all([
    supabase
      .from("catalogue_offres")
      .select("id, nom, categorie, description, prix_ht, tva_pct")
      .eq("actif", true)
      .eq("tarif_type", "fixe")
      .not("prix_ht", "is", null)
      .order("ordre"),
    supabase.rpc("list_my_groups"),
    fetchMyAthletes(supabase).catch(() => []),
  ]);

  let beneficiary: FundingBeneficiary | null = null;
  if ((benefKind === "linked" || benefKind === "managed") && benefId) {
    const athlete = athletes.find((a) => a.kind === benefKind && a.refId === benefId && a.rights.cotisation);
    if (athlete) beneficiary = { kind: benefKind, id: benefId, label: `${athlete.firstName} ${athlete.lastName}`.trim() };
  }

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <CreateFundingWizard
        offres={(offres || []) as OffreOption[]}
        groups={(groups || []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })) as GroupOption[]}
        initialGroupId={groupe || null}
        initialOfferId={offreId || null}
        beneficiary={beneficiary}
        basePath="/particulier/cotisations"
      />
    </ParticularShell>
  );
}
