import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { AddClubForm } from "./AddClubForm";

// Ajouter mon club — pour un utilisateur DÉJÀ authentifié sans affiliation, appelée depuis les
// CTA "Ajouter mon club" du Dashboard et de Mes affiliations.
//
// Corrige un parcours cassé : ces deux CTA pointaient vers /signup/club (l'étape 4 du tunnel
// d'inscription PRÉ-compte), qui exige state.email + state.password dans le SignupContext. Ce
// state n'existe jamais pour un utilisateur déjà connecté (le mot de passe n'est jamais persisté
// en localStorage par design — voir signup-context.tsx), donc la page renvoyait systématiquement
// vers /signup — un compte déjà authentifié atterrissait sur l'écran de CRÉATION de compte, et
// en le validant, auth.signUp() échouait avec "adresse déjà utilisée". Cette page réutilise la
// même Edge Function (connect-player-onboarding, actions "join"/"declare") mais avec la session
// déjà active, sans jamais rappeler auth.signUp().
export default async function AjouterClubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  // Une seule affiliation à la fois (voir note dans lib/supabase/session.ts) : rien à faire ici
  // si un club est déjà rattaché, même en attente ou refusé — l'utilisateur doit d'abord quitter
  // l'affiliation existante depuis Mes affiliations.
  if (player?.club) redirect("/affiliations");

  const metaFirst = typeof user.user_metadata?.first_name === "string" ? user.user_metadata.first_name : "";
  const metaLast = typeof user.user_metadata?.last_name === "string" ? user.user_metadata.last_name : "";
  const firstName = player?.firstName || metaFirst || user.email?.split("@")[0] || "";
  const lastName = player?.lastName || metaLast || "";

  return (
    <AppShell firstName={firstName}>
      <div className="flex max-w-[560px] flex-col gap-6 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[28px] font-bold tracking-tight">Ajouter mon club</h1>
          <p className="text-[15px] leading-relaxed text-text-tertiary">
            Recherchez votre club partenaire SportVision, ou ajoutez-le manuellement s&apos;il
            n&apos;est pas encore partenaire.
          </p>
        </div>
        <AddClubForm initialFirstName={firstName} initialLastName={lastName} />
      </div>
    </AppShell>
  );
}
