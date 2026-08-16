import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";

// Layout partagé de l'Espace joueur — monte AppShell UNE SEULE FOIS pour toutes les routes de ce
// groupe (acces, affiliations, calendrier, commandes, contenus, cotisations, dashboard, equipes,
// factures, messages, prestations, profil), au lieu que chacune des ~21 pages l'enveloppe
// individuellement comme avant ce chantier — même raisonnement et même bénéfice de perf perçue
// que src/app/particulier/layout.tsx (voir son commentaire). Route group `(joueur)` : invisible
// dans l'URL, /dashboard reste bien `/dashboard` (pas `/joueur/dashboard`).
//
// IMPORTANT — contrairement à ParticularShell/particulier/layout.tsx, ce layout n'appelle PAS
// requireJoueurAccount() : deux raisons qui interdisent de le faire ici, toutes les deux
// vérifiées avant d'écrire ce fichier.
// 1. `/equipes/rejoindre/[id]` appelle `requireJoueurAccount(supabase, "/equipes/rejoindre/"+id)`
//    (SEULE route à passer un `next` personnalisé, pour revenir sur le lien d'invitation après
//    connexion) — un appel générique ici, sans connaître ce `next`, redirigerait un visiteur non
//    connecté vers "/auth/login" nu et lui ferait perdre son lien d'invitation.
// 2. `/dashboard` gère elle-même sa redirection account_type (voir dashboard/page.tsx et la
//    consigne de la mission : "la redirection reste dans la page") — un garde-fou ici la
//    court-circuiterait.
// Ce layout se contente donc du STRICT nécessaire pour afficher le shell (firstName), avec repli
// silencieux si aucun utilisateur n'est résolu : chaque page continue d'appeler son propre
// garde-fou (requireJoueurAccount ou, pour /dashboard, sa vérification dédiée) et gère la
// redirection réelle — ce layout ne fait que le rendu visuel, jamais l'autorisation.
export default async function JoueurLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const player = user ? await buildPlayerContext(supabase, user.id) : null;
  const firstName = player?.firstName || user?.email?.split("@")[0] || "";

  return <AppShell firstName={firstName}>{children}</AppShell>;
}
