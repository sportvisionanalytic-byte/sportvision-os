import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { URL_OS } from "@/lib/supabase/session";
import { SeDeconnecter } from "./SeDeconnecter";

// Un compte de collaborateur SportVision (photographe, vidéaste, production, CM…) arrivé dans
// Connect — par un lien d'e-mail, un favori, le site. Connect est l'espace des joueurs et des
// familles ; son outil de travail est l'OS, avec les mêmes identifiants. Voir
// redirigerSiCollaborateur (lib/supabase/session.ts) pour le pourquoi (10/09/2026).
export default async function CollaborateurPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-5 py-10">
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 rounded-sv-card border border-border-strong bg-surface p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
          <span className="material-symbols-rounded !text-[24px] text-affiliations" aria-hidden="true">
            work
          </span>
        </span>
        <span className="font-sora text-[18px] font-semibold">Votre espace de travail est SportVision OS</span>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Ce compte est celui d&apos;un collaborateur SportVision. Connect est l&apos;espace des joueurs et des familles :
          vos missions, votre planning et votre matériel sont dans l&apos;OS, avec la même adresse e-mail et le même mot
          de passe.
        </p>
        <a href={URL_OS} className="rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white">
          Ouvrir SportVision OS
        </a>
        <p className="text-[12.5px] text-text-tertiary">
          Mot de passe oublié ? Utilisez « Mot de passe oublié » sur l&apos;écran de connexion de l&apos;OS : le lien vous y
          ramènera.
        </p>
        <SeDeconnecter />
      </div>
    </div>
  );
}
