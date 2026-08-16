import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { CommandeDetailView } from "@/app/(joueur)/commandes/[id]/CommandeDetailView";

// Fiche commande (Espace particulier) — réutilise CommandeDetailView TEL QUEL (Espace joueur),
// en mode multi:true (voir son en-tête) pour retrouver la commande parmi tous les bénéficiaires
// accessibles, pas seulement le compte de l'appelant.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page ne calcule plus firstName/athletes, qui ne servaient qu'à alimenter le shell.
export default async function CommandeDetailParticulierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  return <CommandeDetailView id={id} multi backHref="/particulier/commandes" />;
}
