"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { ServicesBoard } from "@/components/services/ServicesBoard";
import { ClubServicesBoard } from "@/components/services/ClubServicesBoard";

// /services — voir ACTIONS.md § 12. Kanban et vue liste des prestations de l'organisation
// active. Espace Projet (client_prestations, réel) : bypass du gate canAccess, même pattern que
// /billing — voir le plan Phase 3. Club : catalogue_offres + club_bookings (réel), voir
// ClubServicesBoard.tsx. "services" reste volontairement hors READY_MODULES (entitlements.ts)
// puisque ce gate ne protège que le mismatch ServicesBoard/`prestations`, pas le flux club qui
// lit une table distincte, déjà ouverte à tout membre actif par RLS (is_club_member).
//
// SERVICES_BYPASS_TYPES (club/generic/tournament_organizer/camp) vit maintenant dans
// lib/permissions.ts, à l'intérieur même de canAccess() — corrige un bug remonté le 19/08/2026 :
// la Sidebar affichait un cadenas sur "Prestations" pour un club (elle appelle canAccess() sans
// connaître le bypass local qui vivait ici avant), alors que la page fonctionnait réellement.
// Un seul point de vérité désormais, comme sponsors/presences dans permissions.ts.
export default function ServicesPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "services")) return <LockedModule />;
  if (ctx.organization.type === "club") return <ClubServicesBoard />;
  return <ServicesBoard />;
}
