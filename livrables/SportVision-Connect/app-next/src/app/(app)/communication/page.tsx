"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { NewPublicationModal } from "@/components/communication/NewPublicationModal";
import { PublicationChip } from "@/components/communication/PublicationChip";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { publicationStatusTone } from "@/components/communication/statusTone";
import {
  buildMonthGrid,
  buildWeekDays,
  formatDayLabel,
  formatMonthLabel,
  formatTime,
  isSameDay,
  withNewDay,
} from "@/components/communication/calendarDates";
import { getPublicationsByOrg } from "@/lib/mock/communication";
import { PLATFORM_LABELS, PUBLICATION_STATUS_LABELS, type Publication } from "@/lib/types/communication";
import { cn } from "@/lib/cn";

type ViewMode = "month" | "week" | "list";

// /communication — planning éditorial (Mois / Semaine / Liste), glisser-déposer, fiche
// publication. Voir ACTIONS.md § 14 et CHARTE.md § Glisser-déposer.
export default function CommunicationPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "communication")) return <LockedModule />;
  return <EditorialPlanning organizationId={ctx.organization.id} />;
}

function EditorialPlanning({ organizationId }: { organizationId: string }) {
  const { ctx } = useSession();
  const router = useRouter();
  const { toasts, showToast } = useToast();

  const [publications, setPublications] = useState<Publication[]>(() => getPublicationsByOrg(organizationId));
  const orgRef = useRef(organizationId);
  useEffect(() => {
    if (orgRef.current !== organizationId) {
      orgRef.current = organizationId;
      setPublications(getPublicationsByOrg(organizationId));
    }
  }, [organizationId]);

  const [view, setView] = useState<ViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [newPubOpen, setNewPubOpen] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [justDroppedKey, setJustDroppedKey] = useState<string | null>(null);

  const canDrag = canCreate(ctx, "publication");
  const draggingPublication = publications.find((p) => p.id === draggingId);

  function dateKey(d: Date) {
    return d.toISOString().slice(0, 10);
  }

  function publicationsOnDay(d: Date) {
    return publications
      .filter((p) => isSameDay(new Date(p.scheduledAt), d))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }

  function handleDrop(day: Date) {
    setDragOverKey(null);
    if (!draggingId) return;
    const moved = publications.find((p) => p.id === draggingId);
    setPublications((prev) =>
      prev.map((p) => (p.id === draggingId ? { ...p, scheduledAt: withNewDay(p.scheduledAt, day) } : p)),
    );
    setDraggingId(null);
    const key = dateKey(day);
    setJustDroppedKey(key);
    window.setTimeout(() => setJustDroppedKey((k) => (k === key ? null : k)), 700);
    if (moved) showToast(`« ${moved.title} » déplacée au ${formatDayLabel(day)}.`);
  }

  function navigate(delta: number) {
    setAnchorDate((d) => {
      if (view === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7);
      return new Date(d.getFullYear(), d.getMonth() + delta, 1);
    });
  }

  const periodLabel =
    view === "week"
      ? (() => {
          const days = buildWeekDays(anchorDate);
          return `${formatDayLabel(days[0]!)} — ${formatDayLabel(days[6]!)}`;
        })()
      : formatMonthLabel(anchorDate);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Planning éditorial</h1>
        </div>
        <Button variant="primary" onClick={() => setNewPubOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Ajouter une publication
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-border bg-surface-alt p-1">
          {(
            [
              { key: "month", label: "Mois", icon: CalendarDays },
              { key: "week", label: "Semaine", icon: CalendarDays },
              { key: "list", label: "Liste", icon: List },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-colors",
                view === key ? "bg-surface text-text shadow-sv-card" : "text-text-soft hover:text-text",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {view !== "list" && (
          <div className="flex items-center gap-1.5">
            <button
              aria-label="Période précédente"
              onClick={() => navigate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft hover:border-brand-blue-electric"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-[190px] text-center text-[13.5px] font-extrabold tracking-tight">{periodLabel}</span>
            <button
              aria-label="Période suivante"
              onClick={() => navigate(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft hover:border-brand-blue-electric"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {draggingPublication && (
        <div className="animate-svfade fixed left-1/2 top-[78px] z-40 -translate-x-1/2 rounded-full border border-brand-blue/40 bg-elevated px-4 py-2 text-[12.5px] font-bold text-text shadow-sv-dropdown">
          Déplacement de « {draggingPublication.title} »
        </div>
      )}

      {view === "month" && (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-divider">
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
              <div key={d} className="px-2.5 py-2 text-center text-[10px] font-extrabold uppercase tracking-[.06em] text-text-faint">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {buildMonthGrid(anchorDate).map(({ date, inCurrentMonth }) => {
              const key = dateKey(date);
              const dayPubs = publicationsOnDay(date);
              const isToday = isSameDay(date, new Date());
              return (
                <div
                  key={key}
                  onDragOver={(e) => {
                    if (!inCurrentMonth || !canDrag) return;
                    e.preventDefault();
                    if (dragOverKey !== key) setDragOverKey(key);
                  }}
                  onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                  onDrop={(e) => {
                    if (!inCurrentMonth || !canDrag) return;
                    e.preventDefault();
                    handleDrop(date);
                  }}
                  className={cn(
                    "flex min-h-[112px] flex-col gap-1 border-b border-r border-divider p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                    !inCurrentMonth && "bg-surface-alt/40",
                    dragOverKey === key && "border-dashed border-brand-blue bg-info-bg/50",
                    justDroppedKey === key && "ring-2 ring-inset ring-success-fg",
                  )}
                >
                  <span
                    className={cn(
                      "text-[11.5px] font-bold",
                      inCurrentMonth ? "text-text-soft" : "text-text-faint/60",
                      isToday && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-blue text-white",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
                    {dayPubs.map((p) => (
                      <PublicationChip
                        key={p.id}
                        publication={p}
                        draggable={canDrag}
                        onDragStart={() => setDraggingId(p.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={() => router.push(`/communication/publications/${p.id}`)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {view === "week" && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-7">
          {buildWeekDays(anchorDate).map((date) => {
            const key = dateKey(date);
            const dayPubs = publicationsOnDay(date);
            const isToday = isSameDay(date, new Date());
            return (
              <Card
                key={key}
                onDragOver={(e) => {
                  if (!canDrag) return;
                  e.preventDefault();
                  if (dragOverKey !== key) setDragOverKey(key);
                }}
                onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                onDrop={(e) => {
                  if (!canDrag) return;
                  e.preventDefault();
                  handleDrop(date);
                }}
                className={cn(
                  "flex min-h-[220px] flex-col gap-1.5 p-2.5",
                  dragOverKey === key && "border-dashed border-brand-blue bg-info-bg/50",
                  justDroppedKey === key && "ring-2 ring-inset ring-success-fg",
                )}
              >
                <span className={cn("text-[11.5px] font-extrabold capitalize", isToday ? "text-brand-blue-electric" : "text-text-soft")}>
                  {formatDayLabel(date)}
                </span>
                <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
                  {dayPubs.length === 0 ? (
                    <span className="mt-1 text-[11px] text-text-faint">Rien de prévu</span>
                  ) : (
                    dayPubs.map((p) => (
                      <PublicationChip
                        key={p.id}
                        publication={p}
                        draggable={canDrag}
                        onDragStart={() => setDraggingId(p.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={() => router.push(`/communication/publications/${p.id}`)}
                      />
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <Card className="overflow-hidden p-0">
          {publications.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={CalendarDays}
                title="Aucune publication planifiée"
                subtitle="Commencez par ajouter une publication à votre planning éditorial."
                action={
                  <Button variant="primary" onClick={() => setNewPubOpen(true)}>
                    Ajouter une publication
                  </Button>
                }
              />
            </div>
          ) : (
            [...publications]
              .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/communication/publications/${p.id}`)}
                  className="flex w-full items-center gap-3.5 border-b border-divider px-5 py-3.5 text-left last:border-0 hover:bg-row-hover"
                >
                  <span className="w-[150px] flex-none text-[12.5px] font-bold text-text-soft">
                    {formatDayLabel(new Date(p.scheduledAt))} · {formatTime(new Date(p.scheduledAt))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-text">{p.title}</span>
                  <span className="w-24 flex-none text-[12px] text-text-soft">{PLATFORM_LABELS[p.platform]}</span>
                  <Badge tone={publicationStatusTone(p.status)}>{PUBLICATION_STATUS_LABELS[p.status]}</Badge>
                </button>
              ))
          )}
        </Card>
      )}

      <NewPublicationModal
        open={newPubOpen}
        onClose={() => setNewPubOpen(false)}
        organizationId={organizationId}
        ownerName={`${ctx.user.firstName} ${ctx.user.lastName}`}
        onCreate={(publication) => {
          setPublications((prev) => [...prev, publication]);
          setNewPubOpen(false);
          showToast("Publication ajoutée au planning.");
        }}
      />
      <ToastViewport toasts={toasts} />
    </div>
  );
}
