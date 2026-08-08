"use client";

import { Plus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { sessionsByCoachOrg } from "@/lib/mock/events";
import type { CoachSession } from "@/lib/types/events";
import { LockedModule } from "@/components/persona/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /sessions — séances du coach en Full Communication. ACTIONS.md § 10 « Coach Full Com ».
const STATUS_LABEL: Record<CoachSession["status"], { label: string; tone: BadgeTone }> = {
  capture_planned: { label: "Captation prévue", tone: "info" },
  confirmed: { label: "Confirmée", tone: "success" },
  to_confirm: { label: "À confirmer", tone: "warning" },
};

export default function SessionsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "sessions")) return <LockedModule ctx={ctx} />;

  const sessions = sessionsByCoachOrg[ctx.organization.id] ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Séances</h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
            Vos prochaines séances, leur lieu et le statut de la captation SportVision.
          </p>
        </div>
        <Button variant="primary">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Ajouter une séance
        </Button>
      </div>

      {sessions.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucune séance planifiée pour le moment.</Card>
      )}

      {sessions.length > 0 && (
        <Card>
          {sessions.map((session) => {
            const status = STATUS_LABEL[session.status];
            return (
              <div
                key={session.id}
                className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-4 last:border-0 hover:bg-row-hover"
              >
                <div className="w-[92px] flex-none">
                  <div className="text-[13px] font-extrabold text-text">{session.date}</div>
                  <div className="text-[11.5px] font-semibold text-text-soft">{session.time}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-text">{session.title}</div>
                  <div className="mt-0.5 truncate text-[12px] text-text-soft">{session.location}</div>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
