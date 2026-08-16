import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { fetchPlayerCatalogue } from "@/lib/prestations/catalogue";
import { PrestationsCatalogueView } from "./PrestationsCatalogueView";

// Catalogue Prestations — voir design-connect-personnel-12-08/README.md § Espace joueur →
// Prestations et MASTER-CONNECT-V1.md §17-18. Source unique des prix : `catalogue_offres`
// (lib/prestations/catalogue.ts) — aucun tarif dupliqué ici. Voir le commentaire d'en-tête de
// catalogue.ts pour la décision produit documentée sur l'écart entre le mockup (6 offres,
// 3 familles) et le catalogue réel (7 offres, 2 familles) : ce module montre fidèlement ce qui
// existe réellement en base plutôt que d'inventer une offre "Montage Highlight" sans tarif
// validé.
//
// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function PrestationsPage() {
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

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
