import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { CreateFundingWizard, type OffreOption, type GroupOption } from "./CreateFundingWizard";

// Création de cotisation — voir design-connect-personnel-12-08/README.md § Cotisations
// (4 étapes). Le montant cible n'est jamais calculé ni envoyé par ce formulaire : la RPC
// create_group_funding() (migration-connect-v50) le recalcule elle-même depuis
// catalogue_offres, ce composant ne fait que proposer les prestations à prix fixe (une
// prestation "sur devis" n'a pas de montant à répartir).
//
// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function CreerCotisationPage({
  searchParams,
}: {
  searchParams: Promise<{ groupe?: string; offreId?: string }>;
}) {
  const { groupe, offreId } = await searchParams;
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

  const [{ data: offres }, { data: groups }] = await Promise.all([
    supabase
      .from("catalogue_offres")
      .select("id, nom, categorie, description, prix_ht, tva_pct")
      .eq("actif", true)
      .eq("tarif_type", "fixe")
      .not("prix_ht", "is", null)
      .order("ordre"),
    supabase.rpc("list_my_groups"),
  ]);

  return (
    <CreateFundingWizard
      offres={(offres || []) as OffreOption[]}
      groups={(groups || []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })) as GroupOption[]}
      initialGroupId={groupe || null}
      initialOfferId={offreId || null}
    />
  );
}
