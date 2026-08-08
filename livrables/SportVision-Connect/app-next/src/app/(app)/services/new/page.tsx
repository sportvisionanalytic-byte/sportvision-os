"use client";

import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { ServicesLockedModule } from "@/components/services/LockedModule";
import { NewServiceTunnel } from "@/components/services/NewServiceTunnel";
import { Card } from "@/components/ui/Card";

// /services/new — tunnel de demande en 5 étapes, voir ACTIONS.md § 12.
export default function NewServicePage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "services")) return <ServicesLockedModule />;
  if (!canCreate(ctx, "service_request")) {
    return (
      <Card className="mx-auto max-w-[520px] p-8 text-center text-[13.5px] leading-relaxed text-text-soft">
        Votre rôle ne vous permet pas d&apos;effectuer cette action. Contactez l&apos;administrateur du club pour
        demander un accès supplémentaire.
      </Card>
    );
  }
  return <NewServiceTunnel />;
}
