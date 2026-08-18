import { createClient } from "@/lib/supabase/server";
import { fetchPlayerCatalogue } from "@/lib/prestations/catalogue";
import { PrestationsCatalogueView } from "@/app/(joueur)/prestations/PrestationsCatalogueView";

// Seule page /demo à interroger Supabase : `catalogue_offres` a une policy de lecture publique
// (catalogue_public_read, vérifiée le 19/08) — c'est le même catalogue que /reserver sur le site
// vitrine, déjà visible sans connexion. Aucune donnée utilisateur n'est lue ici.
export default async function DemoPrestationsPage() {
  const supabase = await createClient();
  const offers = await fetchPlayerCatalogue(supabase);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Prestations</h1>
        <p className="max-w-[560px] text-[15px] text-text-tertiary">
          Réservez une couverture photo, vidéo ou une captation pour votre prochain match.
        </p>
      </div>
      <PrestationsCatalogueView offers={offers} />
    </div>
  );
}
