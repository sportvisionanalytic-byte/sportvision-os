"use client";

import { Check, Circle } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { eventPhasesByEventOrg } from "@/lib/mock/events";
import type { EventPhase } from "@/lib/types/events";
import { cn } from "@/lib/cn";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// /eventtimeline — timeline en 3 phases (avant / jour J / après) pour un tournoi en Full
// Communication. ACTIONS.md § 10 « Tournoi Full Com — /eventtimeline ».
const PHASE_STATUS_LABEL: Record<EventPhase["status"], { label: string; tone: BadgeTone }> = {
  planned: { label: "À venir", tone: "neutral" },
  in_progress: { label: "En cours", tone: "info" },
  completed: { label: "Terminée", tone: "success" },
};

export default function EventTimelinePage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "eventtimeline")) return <LockedModule />;

  const phases = eventPhasesByEventOrg[ctx.organization.id] ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Timeline de l&apos;événement</h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
          {ctx.organization.name} — avant, pendant et après l&apos;événement.
        </p>
      </div>

      {phases.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">
          Aucune timeline disponible pour le moment.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {phases.map((phase) => {
          const status = PHASE_STATUS_LABEL[phase.status];
          return (
            <Card key={phase.phase} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[15px] font-extrabold tracking-tight">{phase.label}</div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <div className="mt-1 text-[12px] font-semibold text-text-soft">{phase.dateLabel}</div>
              <div className="mt-4 flex flex-col gap-3">
                {phase.items.map((item) => (
                  <div key={item.label} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full",
                        item.done ? "bg-success-bg text-success-fg" : "bg-neutral-bg text-neutral-fg",
                      )}
                    >
                      {item.done ? (
                        <Check className="h-2.5 w-2.5" aria-hidden />
                      ) : (
                        <Circle className="h-2 w-2" aria-hidden />
                      )}
                    </span>
                    <span>
                      <span className="block text-[13px] font-bold text-text">{item.label}</span>
                      <span className="block text-[11.5px] text-text-soft">{item.description}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
