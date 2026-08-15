import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { CreateGroupForm } from "./CreateGroupForm";

export default async function CreerEquipePage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <div className="flex max-w-[560px] flex-col gap-6 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[28px] font-bold tracking-tight">Créer mon groupe</h1>
          <p className="text-[15px] text-text-tertiary">
            Un nom suffit pour commencer, vous pourrez compléter ensuite.
          </p>
        </div>
        <CreateGroupForm />
      </div>
    </AppShell>
  );
}
