"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { ServicesBoard } from "@/components/services/ServicesBoard";
import { ClubServicesBoard } from "@/components/services/ClubServicesBoard";

// /services — voir ACTIONS.md § 12. Kanban et vue liste des prestations de l'organisation
// active. Espace Projet (client_prestations, réel) : bypass du gate canAccess, même pattern que
// /billing — voir le plan Phase 3. Club : catalogue_offres + club_bookings (réel), voir
// ClubServicesBoard.tsx — bypass canAccess comme /services/new et /services/[id] (même pattern),
// "services" reste volontairement hors READY_MODULES (entitlements.ts) puisque ce gate ne protège
// que le mismatch ServicesBoard/`prestations`, pas le flux club qui lit une table distincte, déjà
// ouverte à tout membre actif par RLS (is_club_member). Tout autre type d'organisation : reste
// verrouillé (canAccess retourne false, "services" hors READY_MODULES depuis la Phase 1).
export default function ServicesPage() {
  const { ctx } = useSession();
  if (ctx.organization.type === "club") return <ClubServicesBoard />;
  if (ctx.organization.type !== "generic" && !canAccess(ctx, "services")) return <LockedModule />;
  return <ServicesBoard />;
}
