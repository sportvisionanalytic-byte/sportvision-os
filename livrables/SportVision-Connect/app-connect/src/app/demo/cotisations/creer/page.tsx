import { createClient } from "@/lib/supabase/server";
import { CreateFundingWizard, type OffreOption, type GroupOption } from "@/app/(joueur)/cotisations/creer/CreateFundingWizard";
import { DEMO_GROUPS } from "@/lib/demo/mock-data";

// Démo : catalogue_offres est public en lecture (même raisonnement que /demo/prestations).
// "Mes équipes" vient de mock-data.ts (list_my_groups exigerait une vraie session).
// demoMode=true (audit du 31/08/2026) : le dernier clic ("Créer le paiement collectif")
// n'appelle plus la vraie RPC create_group_funding — voir le commentaire de `demoMode` dans
// CreateFundingWizard.tsx pour l'écriture réelle que ça évitait pour un visiteur démo par
// ailleurs connecté (session réelle + "Partage libre" + offre réelle = insert réel possible).
export default async function DemoCreerCotisationPage() {
  const supabase = await createClient();
  const { data: offres } = await supabase
    .from("catalogue_offres")
    .select("id, nom, categorie, description, prix_ht, tva_pct")
    .eq("actif", true)
    .eq("tarif_type", "fixe")
    .not("prix_ht", "is", null)
    .order("ordre");

  const groups: GroupOption[] = DEMO_GROUPS.map((g) => ({ id: g.id, name: g.name }));

  return (
    <CreateFundingWizard
      offres={(offres || []) as OffreOption[]}
      groups={groups}
      initialGroupId={null}
      basePath="/demo/cotisations"
      demoMode
    />
  );
}
