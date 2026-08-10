"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, Circle } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { fetchEventChecklist, type EventChecklistItem, type EventChecklistPhase } from "@/lib/data/shared/event-checklist";
import { cn } from "@/lib/cn";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// /eventtimeline — checklist en 3 phases (avant / jour J / après) pour un tournoi en Full
// Communication. Lit event_checklist_items (migration-connect-v22-event-checklist-items.sql) par
// organization_id direct — pas de résolution client_id nécessaire ici (contrairement à
// sessions/camps) : une organisation event n'a pas de facturation/documents Portail au même sens
// qu'un club, et la checklist n'a besoin de rien d'autre que l'organisation elle-même. Lecture
// seule côté Connect (le staff coche/décoche depuis SportVision-OS-Full.html, policy
// eci_staff_write) : aucune case n'est cliquable ici, mêmes icônes indicatrices qu'avant.
//
// Plus de "dateLabel"/"status" par phase (mock d'origine, entièrement inventés — aucune colonne
// réelle n'existe pour dater un événement) : remplacés par un badge réel "N/4 faites", calculé
// depuis les items chargés.
const PHASE_ORDER: EventChecklistPhase[] = ["avant", "jour_j", "apres"];
const PHASE_LABELS: Record<EventChecklistPhase, string> = {
  avant: "Avant l'événement",
  jour_j: "Jour J",
  apres: "Après l'événement",
};

function progressTone(done: number, total: number): BadgeTone {
  if (total === 0) return "neutral";
  if (done === total) return "success";
  if (done === 0) return "neutral";
  return "info";
}

function fmtFaitLe(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export default function EventTimelinePage() {
  const { ctx } = useSession();
  const [items, setItems] = useState<EventChecklistItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (ctx.organization.type !== "event") return;
    const supabase = createClient();
    fetchEventChecklist(supabase, ctx.organization.id)
      .then(setItems)
      .catch(() => setLoadError(true));
  }, [ctx.organization.id, ctx.organization.type]);

  if (ctx.organization.type !== "event" || !canAccess(ctx, "eventtimeline")) return <LockedModule />;

  const header = (
    <div>
      <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Timeline de l&apos;événement</h1>
      <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
        {ctx.organization.name} — avant, pendant et après l&apos;événement.
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Impossible de charger la checklist.</Card>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <CalendarClock className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Checklist pas encore préparée</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore généré la checklist de cet événement. Contactez votre interlocuteur
              SportVision.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PHASE_ORDER.map((phase) => {
          const phaseItems = items.filter((item) => item.phase === phase);
          if (phaseItems.length === 0) return null;
          const done = phaseItems.filter((item) => item.fait).length;
          return (
            <Card key={phase} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[15px] font-extrabold tracking-tight">{PHASE_LABELS[phase]}</div>
                <Badge tone={progressTone(done, phaseItems.length)}>
                  {done}/{phaseItems.length} faites
                </Badge>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {phaseItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full",
                        item.fait ? "bg-success-bg text-success-fg" : "bg-neutral-bg text-neutral-fg",
                      )}
                    >
                      {item.fait ? <Check className="h-2.5 w-2.5" aria-hidden /> : <Circle className="h-2 w-2" aria-hidden />}
                    </span>
                    <span>
                      <span className="block text-[13px] font-bold text-text">{item.label}</span>
                      {item.fait && item.faitLe && (
                        <span className="block text-[11.5px] text-text-soft">Fait le {fmtFaitLe(item.faitLe)}</span>
                      )}
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
