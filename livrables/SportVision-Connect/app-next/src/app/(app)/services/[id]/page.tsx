"use client";

import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { getServiceById } from "@/lib/mock/services";
import { LockedModule } from "@/components/ui/LockedModule";
import { ClubServiceRequestNotice } from "@/components/services/ClubServiceRequestNotice";
import { ServiceDetail } from "@/components/services/ServiceDetail";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// /services/:id — fiche prestation à 10 onglets, voir ACTIONS.md § 12. Même gate que
// /services/new (voir son commentaire) : organization.type piloté directement, "services" hors
// READY_MODULES. La fiche à 10 onglets (équipe, jalons, livrables, fichiers, messages — aucun
// n'a d'équivalent réel côté `prestations`) reste hors scope de branchement réel pour l'Espace
// Projet : getServiceById (mock) résout honnêtement "introuvable" pour une vraie prestation
// créée par le tunnel plutôt que d'afficher une fiche à moitié fabriquée — voir lib/data/projet/
// services.ts en tête de fichier pour la décision documentée (plan Phase 3 § Hors scope).
export default function ServiceDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  if (ctx.organization.type === "club") return <ClubServiceRequestNotice />;
  if (ctx.organization.type !== "generic") return <LockedModule />;

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
