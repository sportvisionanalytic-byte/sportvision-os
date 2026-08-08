"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { ServicesBoard } from "@/components/services/ServicesBoard";

// /services — voir ACTIONS.md § 12. Kanban et vue liste des prestations de l'organisation
// active.
export default function ServicesPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "services")) return <LockedModule />;
  return <ServicesBoard />;
}
