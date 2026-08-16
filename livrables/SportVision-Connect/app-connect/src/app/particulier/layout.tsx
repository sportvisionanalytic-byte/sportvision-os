import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, resolveDisplayIdentity, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";

// Layout partagé de l'Espace particulier — monte ParticularShell UNE SEULE FOIS pour toutes les
// routes /particulier/** (Next.js App Router persiste ce composant client entre navigations dans
// ce segment), au lieu que chacune des ~20 pages l'enveloppe individuellement comme avant ce
// chantier. Avant : chaque changement de page démontait/remontait tout le chrome (sidebar,
// topbar, bottom nav, NotificationBell), donc refaisait systématiquement l'appel réseau avatar/
// profil_particulier (useEffect de ParticularShell.tsx) au lieu de le faire une fois — cause
// probable de la lenteur perçue à chaque navigation. Ce layout ne change AUCUN comportement
// métier : il reprend exactement le calcul firstName/athletes qui était dupliqué à l'identique
// dans chaque page.tsx (buildPlayerContext + resolveDisplayIdentity + fetchMyAthletes, voir par
// exemple l'ancien particulier/page.tsx ou particulier/prestations/page.tsx).
//
// requireParticulierAccount() tourne ICI (comme il tournait déjà dans chaque page) pour pouvoir
// calculer firstName/athletes — mais chaque page.tsx CONTINUE d'appeler son propre garde-fou
// (voir leur premier appel `const { user } = await requireParticulierAccount(supabase);`) :
// cette duplication d'appel est volontaire (consigne de la mission), pas une régression.
export default async function ParticulierLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  const [player, athletes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      {children}
    </ParticularShell>
  );
}
