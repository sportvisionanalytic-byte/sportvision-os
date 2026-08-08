"use client";

import { Plus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { campsByAcademyOrg } from "@/lib/mock/events";
import type { Camp } from "@/lib/types/events";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /camps — stages de l'académie en Full Communication. ACTIONS.md § 10 « Académie Full Com ».
const STATUS_LABEL: Record<Camp["status"], { label: string; tone: BadgeTone }> = {
  upcoming: { label: "À venir", tone: "info" },
  open: { label: "Inscriptions ouvertes", tone: "success" },
  full: { label: "Complet", tone: "warning" },
  running: { label: "En cours", tone: "accent" },
  completed: { label: "Terminé", tone: "neutral" },
};

export default function CampsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "camps")) return <LockedModule />;

  const camps = campsByAcademyOrg[ctx.organization.id] ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Stages</h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
            Vos stages, leurs groupes et leur taux de remplissage.
          </p>
        </div>
        <Button variant="primary">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Créer un stage
        </Button>
      </div>

      {camps.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucun stage pour le moment.</Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {camps.map((camp) => {
          const pct = Math.round((camp.registered / camp.capacity) * 100);
          const status = STATUS_LABEL[camp.status];
          return (
            <Card key={camp.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[15px] font-extrabold tracking-tight">{camp.name}</div>
                  <div className="mt-0.5 text-[12.5px] text-text-soft">
                    {camp.startsAt} → {camp.endsAt} · {camp.venue}
                  </div>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {camp.groups.map((g) => (
                  <span key={g} className="rounded-full bg-neutral-bg px-2.5 py-1 text-[11px] font-bold text-neutral-fg">
                    {g}
                  </span>
                ))}
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between text-[12px] font-semibold text-text-soft">
                  <span>Inscriptions</span>
                  <span className="font-extrabold text-text">
                    {camp.registered} / {camp.capacity}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
