"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, LayoutGrid, List, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { getServicesForOrganization } from "@/lib/mock/services";
import { fetchClientServices } from "@/lib/data/projet/services";
import { createClient } from "@/lib/supabase/client";
import type { Service } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { KanbanBoard } from "./KanbanBoard";
import { ServicesListTable } from "./ServicesListTable";

type ViewMode = "kanban" | "list";

// Écran /services — voir ACTIONS.md § 12. Une seule action principale : demander une
// prestation. Le kanban et la liste partagent le même jeu de données filtré par organisation
// active (rechargé au changement d'organisation, voir README.md § Les treize expériences).
//
// Espace Projet (client_prestations, réel) vs autres types d'organisation (encore mock, voir le
// plan Phase 1/3 — /services reste verrouillé pour le club faute de prix/statuts fiables côté
// club_bookings). Voir data/projet/services.ts pour le détail du branchement.
export function ServicesBoard() {
  const { ctx } = useSession();
  const [view, setView] = useState<ViewMode>("kanban");
  const isProjet = ctx.organization.type === "generic";
  const [realServices, setRealServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!isProjet) return;
    setLoadError(false);
    const supabase = createClient();
    fetchClientServices(supabase, ctx.organization.id)
      .then(setRealServices)
      .catch(() => setLoadError(true));
  }, [isProjet, ctx.organization.id]);

  const services = useMemo(
    () => (isProjet ? (realServices ?? []) : getServicesForOrganization(ctx.organization.id)),
    [isProjet, realServices, ctx.organization.id],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Prestations</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex rounded-[11px] border border-border-strong bg-input-bg p-0.5">
            <ViewToggleButton active={view === "kanban"} onClick={() => setView("kanban")} label="Vue kanban">
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </ViewToggleButton>
            <ViewToggleButton active={view === "list"} onClick={() => setView("list")} label="Vue liste">
              <List className="h-4 w-4" aria-hidden />
            </ViewToggleButton>
          </div>
          <Link href="/services/new">
            <Button variant="primary">Demander une prestation</Button>
          </Link>
        </div>
      </div>

      {isProjet && loadError ? (
        <Card className="flex flex-col items-center gap-3 border-danger-fg/30 bg-danger-bg p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div className="text-[15px] font-extrabold tracking-tight text-danger-fg">
            Impossible de charger vos prestations.
          </div>
          <p className="max-w-[380px] text-[13.5px] leading-relaxed text-text-soft">
            Une erreur est survenue lors du chargement. Réessayez dans quelques instants.
          </p>
        </Card>
      ) : isProjet && realServices === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement de vos prestations…</div>
      ) : services.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-info-bg text-info-fg">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="text-[15px] font-extrabold tracking-tight">Vous n&apos;avez encore créé aucune prestation.</div>
          <p className="max-w-[380px] text-[13.5px] leading-relaxed text-text-soft">
            Commencez par demander votre première prestation : match, entraînement, événement de club ou tout autre
            besoin de captation.
          </p>
          <Link href="/services/new">
            <Button variant="primary">Demander une prestation</Button>
          </Link>
        </Card>
      ) : view === "kanban" ? (
        <KanbanBoard services={services} />
      ) : (
        <ServicesListTable services={services} />
      )}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 w-9 items-center justify-center rounded-[9px] transition-colors duration-sv",
        active ? "bg-elevated text-text shadow-sv-card" : "text-text-faint hover:text-text-soft",
      )}
    >
      {children}
    </button>
  );
}
