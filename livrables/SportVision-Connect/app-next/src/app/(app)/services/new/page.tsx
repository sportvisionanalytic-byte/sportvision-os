"use client";

import { useSession } from "@/lib/session-context";
import { canCreate } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { ClubServiceRequestNotice } from "@/components/services/ClubServiceRequestNotice";
import { NewServiceTunnel } from "@/components/services/NewServiceTunnel";
import { Card } from "@/components/ui/Card";

// /services/new — tunnel de demande en 5 étapes, voir ACTIONS.md § 12. "services" est
// délibérément absent de READY_MODULES (voir entitlements.ts) : le gate se fait donc ici
// directement sur organization.type, même pattern que /services (page.tsx) et /appointments.
// Espace Projet (client_prestations, réel) : seul type dont le tunnel écrit vraiment dans
// `prestations`, voir NewServiceTunnel.tsx. Club : écran honnête dédié plutôt que le message
// générique "module non activé" (LockedModule), voir ClubServiceRequestNotice. Tout autre type
// (coach/académie/sponsor/événement/agence CM/joueur/parent) : LockedModule générique, aucune
// régression par rapport à avant (canAccess(ctx, "services") était déjà toujours faux pour eux).
export default function NewServicePage() {
  const { ctx } = useSession();
  if (ctx.organization.type === "club") return <ClubServiceRequestNotice />;
  if (ctx.organization.type !== "generic") return <LockedModule />;
  if (!canCreate(ctx, "service_request")) {
    return (
      <Card className="mx-auto max-w-[520px] p-8 text-center text-[13.5px] leading-relaxed text-text-soft">
        Votre rôle ne vous permet pas d&apos;effectuer cette action. Contactez l&apos;administrateur de votre espace
        pour demander un accès supplémentaire.
      </Card>
    );
  }
  return <NewServiceTunnel />;
}
