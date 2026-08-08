import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SessionProvider } from "@/lib/session-context";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { NoActiveSpace } from "@/components/layout/NoActiveSpace";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_SPACE_COOKIE,
  buildClubActiveContext,
  buildParentActiveContext,
  buildPlayerActiveContext,
  getSpaces,
  pickActiveSpace,
  type Space,
} from "@/lib/supabase/session";
import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import type { ActiveContext } from "@/lib/types";

function buildActiveContext(supabase: SupabaseClient, user: SupabaseUser, space: Space): Promise<ActiveContext | null> {
  if (space.kind === "organization") return buildClubActiveContext(supabase, user, space);
  if (space.kind === "player") return buildPlayerActiveContext(supabase, user, space);
  return buildParentActiveContext(supabase, user, space);
}

// Coque de l'application authentifiée — barre latérale sticky 264 px + barre supérieure 66 px
// + zone centrale. Voir README.md § Architecture d'interface. Toutes les routes applicatives
// (dashboard, services, content, ...) vivent sous ce groupe de routes sans préfixe d'URL.
//
// Server Component : résout la session et l'espace actif réels avant de monter quoi que ce soit
// (voir le plan Phase 1 § Décisions d'architecture n°2). Aucune page interne n'est jamais montée
// sans un ActiveContext valide — SessionProvider garantit ctx non-nul aux 63 consommateurs
// existants de useSession().
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const spaces = await getSpaces(supabase, user.id);
  const cookieStore = await cookies();
  const rememberedKey = cookieStore.get(ACTIVE_SPACE_COOKIE)?.value;
  const activeSpace = pickActiveSpace(spaces, rememberedKey);
  const ctx = activeSpace ? await buildActiveContext(supabase, user, activeSpace) : null;

  if (!ctx) {
    return <NoActiveSpace spaces={spaces} />;
  }

  return (
    <SessionProvider initialCtx={ctx} initialSpaces={spaces}>
      <div className="flex min-h-screen bg-bg text-text">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="min-w-0 flex-1 px-7 py-6">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
