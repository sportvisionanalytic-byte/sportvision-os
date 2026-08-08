"use client";

import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { getServiceById } from "@/lib/mock/services";
import { ServicesLockedModule } from "@/components/services/LockedModule";
import { ServiceDetail } from "@/components/services/ServiceDetail";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// /services/:id — fiche prestation à 10 onglets, voir ACTIONS.md § 12.
export default function ServiceDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  if (!canAccess(ctx, "services")) return <ServicesLockedModule />;

  const service = getServiceById(params.id);

  // Sécurité — voir DATA_MODEL.md § Sécurité : un utilisateur ne doit jamais accéder à une
  // ressource d'une autre organisation en changeant l'id dans l'URL. En production cette
  // vérification se fait côté serveur ; ici, faute de backend, on filtre côté client sur
  // l'organisation active.
  if (!service || service.organizationId !== ctx.organization.id) {
    return (
      <Card className="mx-auto flex max-w-[480px] flex-col items-center gap-3 p-9 text-center">
        <div className="text-[16px] font-extrabold tracking-tight">Prestation introuvable</div>
        <p className="text-[13.5px] text-text-soft">
          Cette prestation n&apos;existe pas ou n&apos;est pas rattachée à {ctx.organization.name}.
        </p>
        <Link href="/services">
          <Button variant="primary">Retour aux prestations</Button>
        </Link>
      </Card>
    );
  }

  return <ServiceDetail service={service} />;
}
