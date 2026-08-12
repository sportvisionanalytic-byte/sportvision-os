import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Placeholder — la Phase 2 (voir RAPPORT-MIGRATION-CONNECT-PERSONNEL.md § 8) branche ici le
// vrai shell/nav joueur+particulier et l'accueil du design de référence.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-sans text-text">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="font-sora text-2xl font-semibold">Connecté : {user.email}</h1>
        <p className="text-text-tertiary">
          Shell et navigation à venir — Phase 2 du chantier Connect personnel.
        </p>
      </div>
    </div>
  );
}
