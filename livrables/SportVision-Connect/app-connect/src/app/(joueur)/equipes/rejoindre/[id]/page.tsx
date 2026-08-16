import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { JoinGroupAction } from "./JoinGroupAction";

// Cible du lien d'invitation généré par InviteGroupButton. Rejoindre passe par la RPC
// join_user_group() (migration-connect-v50) : idempotente (déjà membre = pas d'erreur),
// jamais un insert direct pour garder le message de confirmation server-vérifié.
//
// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx) — ce layout
// n'appelle volontairement PAS requireJoueurAccount (voir son commentaire), donc le `next=`
// personnalisé ci-dessous (seule route de tout l'Espace joueur à en avoir besoin) continue de
// fonctionner exactement comme avant.
export default async function RejoindreEquipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await requireJoueurAccount(supabase, `/equipes/rejoindre/${id}`);

  return (
    <div className="mx-auto flex max-w-[460px] flex-col items-center gap-5 py-10 text-center animate-sv-in">
      <span className="flex h-14 w-14 items-center justify-center rounded-sv bg-affiliations-bg">
        <span className="material-symbols-rounded !text-[28px] text-affiliations" aria-hidden="true">groups</span>
      </span>
      <JoinGroupAction groupId={id} />
      <Link href="/equipes" className="text-[13px] font-medium text-text-tertiary hover:text-text">
        Retour à mes équipes
      </Link>
    </div>
  );
}
