import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { CreateFundingWizard, type OffreOption, type GroupOption } from "./CreateFundingWizard";

// Création de cotisation — voir design-connect-personnel-12-08/README.md § Cotisations
// (4 étapes). Le montant cible n'est jamais calculé ni envoyé par ce formulaire : la RPC
// create_group_funding() (migration-connect-v50) le recalcule elle-même depuis
// catalogue_offres, ce composant ne fait que proposer les prestations à prix fixe (une
// prestation "sur devis" n'a pas de montant à répartir).
export default async function CreerCotisationPage({
  searchParams,
}: {
  searchParams: Promise<{ groupe?: string }>;
}) {
  const { groupe } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

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
    <AppShell firstName={firstName}>
      <CreateFundingWizard
        offres={(offres || []) as OffreOption[]}
        groups={(groups || []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })) as GroupOption[]}
        initialGroupId={groupe || null}
      />
    </AppShell>
  );
}
