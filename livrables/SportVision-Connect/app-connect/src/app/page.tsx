import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Note (audit QA fonctionnelle réservation/compte du 30/08/2026) : le CTA "Créer mon espace
// Connect" affiché après une demande de réservation/devis vitrine (reserver.html, demande-de-
// devis.html) pointe vers "https://connect.sportvision-an.fr/?signup=1&email=...". Pour un
// visiteur NON connecté, `middleware.ts` intercepte cette requête AVANT que ce composant ne
// s'exécute (route "/" absente de PUBLIC_PATHS) — c'est donc là, pas ici, que `signup`/`email`
// sont lus et transformés en redirection vers "/signup?email=..." (voir son commentaire). Ce
// composant ne gère plus que le seul cas qu'il peut réellement atteindre : un visiteur qui A
// DÉJÀ une session (ex. il clique ce même lien alors qu'il est déjà connecté) — direction
// /dashboard, sans jamais lire `searchParams` ici (mort en pratique pour !user, cf. ci-dessus).
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/dashboard" : "/auth/login");
}
