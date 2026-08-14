import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { JoinGroupAction } from "./JoinGroupAction";

// Cible du lien d'invitation généré par InviteGroupButton. Rejoindre passe par la RPC
// join_user_group() (migration-connect-v50) : idempotente (déjà membre = pas d'erreur),
// jamais un insert direct pour garder le message de confirmation server-vérifié.
export default async function RejoindreEquipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth/login?next=/equipes/rejoindre/${id}`);
  }

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <div className="mx-auto flex max-w-[460px] flex-col items-center gap-5 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-sv bg-affiliations-bg">
          <span className="material-symbols-rounded !text-[28px] text-affiliations">groups</span>
        </span>
        <JoinGroupAction groupId={id} />
        <Link href="/equipes" className="text-[13px] font-medium text-text-tertiary hover:text-text">
          Retour à mes équipes
        </Link>
      </div>
    </AppShell>
  );
}
