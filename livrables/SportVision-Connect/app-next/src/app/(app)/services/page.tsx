"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { ServicesBoard } from "@/components/services/ServicesBoard";

// /services — voir ACTIONS.md § 12. Kanban et vue liste des prestations de l'organisation
// active. Espace Projet (client_prestations, réel) : bypass du gate canAccess, même pattern que
// /billing — voir le plan Phase 3. Club : reste verrouillé (canAccess retourne false, "services"
// hors READY_MODULES depuis la Phase 1).
export default function ServicesPage() {
  const { ctx } = useSession();
  if (ctx.organization.type !== "generic" && !canAccess(ctx, "services")) return <LockedModule />;
  return <ServicesBoard />;
}
