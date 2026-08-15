import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { CommandeDetailView } from "./CommandeDetailView";

export default async function CommandeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <CommandeDetailView id={id} />
    </AppShell>
  );
}
