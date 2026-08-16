import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { CommandeDetailView } from "./CommandeDetailView";

// Shell (AppShell) rendu par le layout parent (src/app/(joueur)/layout.tsx).
export default async function CommandeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await requireJoueurAccount(supabase);

  return <CommandeDetailView id={id} />;
}
