import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SessionProvider } from "@/lib/session-context";
import { AppShell } from "@/components/layout/AppShell";
import { NoActiveSpace } from "@/components/layout/NoActiveSpace";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_SPACE_COOKIE,
  buildClubActiveContext,
  buildDelegatedClubActiveContext,
  buildOrgSpaceActiveContext,
  buildParentActiveContext,
  buildPlayerActiveContext,
  buildProjetActiveContext,
  getSpaces,
  GENERIC_ORG_TYPES,
  pickActiveSpace,
  type Space,
} from "@/lib/supabase/session";
import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import type { ActiveContext } from "@/lib/types";

// 17/08/2026 — reprend GENERIC_ORG_TYPES de session.ts (source unique) au lieu d'une copie locale
// restée figée à ["coach","academie","sponsor"] : structure_coaching/tournoi/stage/cm_agency
// tombaient tous dans buildClubActiveContext ci-dessous, qui renvoie toujours null pour eux (pas
// de ligne `clubs`) — écran "Aucun espace disponible" pour tout compte réel de ces 4 types, malgré
// un backend et une UI par ailleurs fonctionnels. Trouvé en creusant le chantier cm_agency.
const GENERIC_SPACE_TYPES = new Set<string>(GENERIC_ORG_TYPES);

function buildActiveContext(supabase: SupabaseClient, user: SupabaseUser, space: Space): Promise<ActiveContext | null> {
  if (space.kind === "organization" && space.organizationType === "projet") {
    return buildProjetActiveContext(supabase, user, space);
  }
  if (space.kind === "organization" && GENERIC_SPACE_TYPES.has(space.organizationType ?? "")) {
    return buildOrgSpaceActiveContext(supabase, user, space);
  }
  if (space.kind === "organization") return buildClubActiveContext(supabase, user, space);
  if (space.kind === "delegated_club") return buildDelegatedClubActiveContext(supabase, user, space);
  if (space.kind === "player") return buildPlayerActiveContext(supabase, user, space);
  return buildParentActiveContext(supabase, user, space);
}

// Coque de l'application authentifiée — barre latérale sticky 264 px (repliée en drawer sous
// `lg`, voir Sidebar.tsx) + barre supérieure 66 px + zone centrale. Voir README.md § Architecture
// d'interface. Toutes les routes applicatives (dashboard, services, content, ...) vivent sous ce
// groupe de routes sans préfixe d'URL.
//
// Server Component : résout la session et l'espace actif réels avant de monter quoi que ce soit
// (voir le plan Phase 1 § Décisions d'architecture n°2). Aucune page interne n'est jamais montée
// sans un ActiveContext valide — SessionProvider garantit ctx non-nul aux 63 consommateurs
// existants de useSession(). AppShell (client) porte l'état du drawer mobile partagé entre
// Header et Sidebar.
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
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
