import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { CreateGroupForm } from "./CreateGroupForm";

// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function CreerEquipePage() {
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[28px] font-bold tracking-tight">Créer mon groupe</h1>
        <p className="text-[15px] text-text-tertiary">
          Un nom suffit pour commencer, vous pourrez compléter ensuite.
        </p>
      </div>
      <CreateGroupForm />
    </div>
  );
}
