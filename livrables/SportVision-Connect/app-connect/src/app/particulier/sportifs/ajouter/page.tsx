import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";

// Ajouter un sportif — voie de choix (README § Ajouter un sportif). Deux voies distinctes,
// jamais mélangées dans un même formulaire : (a) invitation par e-mail d'un compte existant,
// (b) profil géré sans e-mail.
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx).
export default async function AddAthletePage() {
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <Link href="/particulier/sportifs" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Mes sportifs
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[31px] font-bold tracking-tight">Comment souhaitez-vous l&apos;ajouter ?</h1>
        <p className="text-[15px] text-text-tertiary">Deux cas de figure, selon que le sportif possède déjà un compte SportVision Connect.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/particulier/sportifs/ajouter/inviter"
          className="flex min-h-[220px] flex-col gap-3.5 rounded-sv-card border border-border-strong bg-surface p-[22px] hover:border-[rgba(140,169,255,.5)] hover:bg-white/[.08]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-prestations-bg">
            <span className="material-symbols-rounded !text-[24px] text-prestations" aria-hidden="true">link</span>
          </span>
          <span className="font-sora text-[18px] font-semibold tracking-tight">Il possède déjà Connect</span>
          <span className="text-[14px] leading-relaxed text-text-tertiary">
            Envoyez-lui une demande pour relier vos comptes. Il choisit ce que vous pouvez consulter.
          </span>
          <span className="mt-auto flex items-center gap-1.5 font-sora text-[14px] font-semibold text-prestations">
            Envoyer une invitation
            <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">arrow_forward</span>
          </span>
        </Link>

        <Link
          href="/particulier/sportifs/ajouter/gere"
          className="rounded-sv-card p-px hover:brightness-110"
          style={{ background: "linear-gradient(150deg,rgba(34,211,238,.6),rgba(168,85,247,.3) 55%,transparent)" }}
        >
          <div className="flex min-h-[220px] flex-col gap-3.5 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-[22px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[24px] text-affiliations" aria-hidden="true">child_care</span>
            </span>
            <span className="font-sora text-[18px] font-semibold tracking-tight">Il n&apos;a pas encore de compte</span>
            <span className="text-[14px] leading-relaxed text-text-tertiary">
              Créez un profil géré, rattaché à votre compte. Il pourra reprendre la main plus tard sans rien perdre.
            </span>
            <span className="mt-auto flex items-center gap-1.5 font-sora text-[14px] font-semibold text-affiliations">
              Créer un profil géré
              <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">arrow_forward</span>
            </span>
          </div>
        </Link>
      </div>

      <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-[18px] py-4">
        <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">info</span>
        <span className="text-[13px] leading-relaxed text-text-tertiary">
          Le lien déclaré (parent, proche, agent…) est descriptif. Il ne donne aucun accès automatique : les
          autorisations sont accordées par le sportif ou son responsable légal.
        </span>
      </div>
    </div>
  );
}
