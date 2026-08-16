"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { CALENDAR_EVENT_KIND_LABELS, type CalendarEvent, type CalendarEventKind } from "@/lib/types/calendar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { LockedModule } from "@/components/ui/LockedModule";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { KIND_DOT } from "@/components/calendar/calendar-style";
import { EventDetailPanel } from "@/components/calendar/EventDetailPanel";
import { AddEventModal } from "@/components/calendar/AddEventModal";
import { CREATABLE_EVENT_TYPE_MAP, createClubCalendarEvent, fetchClubCalendarEvents } from "@/lib/data/club/calendar";
import { fetchOrgCalendarEvents } from "@/lib/data/shared/calendar-events";
import { createClient } from "@/lib/supabase/client";

// Filtre "Type" : les 6 valeurs réellement possibles pour club_calendar_events.type (contrainte
// check, migration-clubplus-v4.sql), pas les 10 CalendarEventKind du design — même restriction
// que le <select> de création (AddEventModal.tsx), qui utilise déjà cette même map.
const FILTERABLE_KINDS = Object.keys(CREATABLE_EVENT_TYPE_MAP) as CalendarEventKind[];

// /calendar — voir ACTIONS.md § 15. Calendrier central agrégé (mois/semaine/jour/liste) :
// « fusionne matchs, entraînements, prestations, tournages, réunions, publications, échéances de
// contrat, factures, événements, stages, tournois » (DATA_MODEL.md § CalendarEvent) sans
// duplication de composant selon le contexte.

type ViewMode = "month" | "week" | "day" | "list";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export default function CalendarPage() {
  const { ctx } = useSession();
  const today = useMemo(() => startOfToday(), []);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewMode>("month");
  const [reference, setReference] = useState<Date>(today);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [teamFilter, setTeamFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<CalendarEventKind | "">("");

  // calendar_events générique (Coach/Académie/Sponsor, Phase 4) est en lecture seule côté membre
  // (écriture réservée au staff SportVision) — contrairement à club_calendar_events.
  const isGenericOrg = ["coach", "academy", "sponsor"].includes(ctx.organization.type);
  const isPlayer = ctx.organization.type === "player";
  // Un joueur n'a pas son propre calendrier : il lit celui de son club (brief Fouka § 11 — "voir
  // matchs, shootings SportVision, Media Days, tournages, événements du club"). club_calendar_events
  // /club_matches sont scopés par club_id, PAS par ctx.organization.id (= player_profiles.id pour
  // un joueur) — passer ctx.organization.id ici ne matchait jamais aucun club réel et affichait
  // toujours un calendrier vide, bug trouvé en construisant cette vue. parentOrganizationId est le
  // club_id réel (toujours renseigné pour un joueur, voir session.ts:buildPlayerActiveContext).
  const calendarOrgId = isPlayer ? ctx.organization.parentOrganizationId : ctx.organization.id;

  const loadEvents = useCallback(() => {
    if (!calendarOrgId) return;
    let cancelled = false;
    setLoadError(false);
    const supabase = createClient();
    const fetcher = isGenericOrg
      ? fetchOrgCalendarEvents(supabase, calendarOrgId)
      : fetchClubCalendarEvents(supabase, calendarOrgId);
    fetcher
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarOrgId, isGenericOrg]);

  useEffect(() => loadEvents(), [loadEvents]);

  // Hooks appelés inconditionnellement avant tout `return` — sortedEvents doit être calculé ici,
  // pas après le early-return de canAccess ci-dessous (règle des Hooks React).
  const sortedEvents = useMemo(
    () => [...(events ?? [])].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [events],
  );

  // Liste dérivée des valeurs `team` réellement présentes pour ce club (jamais une liste
  // inventée) — calculée sur `events` non filtré pour que les deux équipes restent proposables
  // même quand un filtre de type est déjà actif.
  const availableTeams = useMemo(
    () =>
      Array.from(new Set((events ?? []).map((e) => e.teamName).filter((t): t is string => Boolean(t)))).sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      sortedEvents.filter((e) => {
        if (teamFilter && e.teamName !== teamFilter) return false;
        if (typeFilter && e.kind !== typeFilter) return false;
        return true;
      }),
    [sortedEvents, teamFilter, typeFilter],
  );

  if (!canAccess(ctx, "calendar")) return <LockedModule title="Calendrier" />;

  if (loadError) {
    return (
      <Card>
        <ErrorState message="Impossible de charger le calendrier." onRetry={loadEvents} />
      </Card>
    );
  }

  if (events === null) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-11 w-44 rounded-sv" />
        </div>
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 gap-px bg-divider p-px">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-none" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  function eventsOnDay(day: Date): CalendarEvent[] {
    return filteredEvents.filter((e) => isSameDay(new Date(e.startsAt), day));
  }

  function navigate(direction: -1 | 1) {
    if (view === "month") {
      setReference((d) => new Date(d.getFullYear(), d.getMonth() + direction, 1));
    } else if (view === "week") {
      setReference((d) => addDays(d, direction * 7));
    } else if (view === "day") {
      setReference((d) => addDays(d, direction));
    }
  }

  function handleCreateEvent(input: { title: string; kind: CalendarEventKind; date: string; time?: string; location?: string }) {
    const supabase = createClient();
    return createClubCalendarEvent(supabase, ctx.organization.id, {
      title: input.title,
      kind: input.kind,
      date: input.date,
      time: input.time,
      location: input.location,
    }).then((created) => setEvents((prev) => (prev ? [...prev, created] : prev)));
  }

  function exportIcal() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SportVision Connect//FR"];
    for (const e of sortedEvents) {
      const dt = `${new Date(e.startsAt).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
      lines.push("BEGIN:VEVENT", `UID:${e.id}`, `DTSTART:${dt}`, `SUMMARY:${e.title}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sportvision-connect.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodLabel = (() => {
    if (view === "month") return reference.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    if (view === "day") return reference.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (view === "week") {
      const start = startOfWeek(reference);
      const end = addDays(start, 6);
      return `${start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return "Tous les événements à venir";
  })();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-tight">Calendrier</h1>
          <p className="mt-1 text-[13.5px] text-text-soft">
            {isPlayer
              ? "Matchs, shootings SportVision et événements de votre club."
              : "Matchs, prestations, tournages, publications et échéances au même endroit."}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={exportIcal}>
            <Download className="h-4 w-4" aria-hidden />
            Exporter (iCal)
          </Button>
          {/* Un joueur consulte le calendrier de son club, il ne le modifie pas (brief § 11 :
              "le joueur ne devrait pas modifier le planning officiel") — même retrait que pour
              coach/académie/sponsor (calendrier en lecture seule côté membre). */}
          {!isGenericOrg && !isPlayer && (
            <Button disabled={!canCreate(ctx, "calendar_event")} onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Ajouter un événement
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-border p-1">
          {(["month", "week", "day", "list"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                view === mode ? "bg-gradient-to-r from-brand-blue to-brand-violet text-white" : "text-text-soft hover:text-text",
              )}
            >
              {{ month: "Mois", week: "Semaine", day: "Jour", list: "Liste" }[mode]}
            </button>
          ))}
        </div>

        {view !== "list" && (
          <div className="flex items-center gap-2">
            <button
              aria-label="Période précédente"
              onClick={() => navigate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft hover:bg-surface-sunken"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-[160px] text-center text-[13.5px] font-extrabold capitalize">{periodLabel}</span>
            <button
              aria-label="Période suivante"
              onClick={() => navigate(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong text-text-soft hover:bg-surface-sunken"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button onClick={() => setReference(today)} className="ml-1 text-[12px] font-bold text-brand-blue-electric">
              Aujourd&apos;hui
            </button>
          </div>
        )}
      </div>

      {!isGenericOrg && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">Filtrer</span>
          {availableTeams.length > 0 && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              aria-label="Filtrer par équipe"
              className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-bold text-text outline-none focus-visible:border-brand-blue"
            >
              <option value="">Toutes les équipes</option>
              {availableTeams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          )}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CalendarEventKind | "")}
            aria-label="Filtrer par type"
            className="h-9 rounded-lg border border-border-strong bg-input-bg px-2.5 text-[12.5px] font-bold text-text outline-none focus-visible:border-brand-blue"
          >
            <option value="">Tous les types</option>
            {FILTERABLE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CALENDAR_EVENT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          {(teamFilter || typeFilter) && (
            <button
              onClick={() => {
                setTeamFilter("");
                setTypeFilter("");
              }}
              className="text-[12px] font-bold text-brand-blue-electric"
            >
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {view === "month" && (
        <MonthView reference={reference} eventsOnDay={eventsOnDay} onSelect={setSelectedEvent} today={today} />
      )}
      {view === "week" && (
        <WeekView reference={reference} eventsOnDay={eventsOnDay} onSelect={setSelectedEvent} today={today} />
      )}
      {view === "day" && <DayView reference={reference} events={eventsOnDay(reference)} onSelect={setSelectedEvent} />}
      {view === "list" && <ListView events={filteredEvents} onSelect={setSelectedEvent} today={today} />}

      {selectedEvent && <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
      {addOpen && <AddEventModal onClose={() => setAddOpen(false)} onCreate={handleCreateEvent} />}
    </div>
  );
}

function EventChip({ event, onSelect }: { event: CalendarEvent; onSelect: (e: CalendarEvent) => void }) {
  return (
    <button
      onClick={() => onSelect(event)}
      className="flex w-full items-center gap-1.5 rounded-md bg-surface-alt px-1.5 py-1 text-left text-[10.5px] font-bold text-text hover:bg-row-hover"
    >
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", KIND_DOT[event.kind])} aria-hidden />
      <span className="truncate">{event.title}</span>
    </button>
  );
}

function MonthView({
  reference,
  eventsOnDay,
  onSelect,
  today,
}: {
  reference: Date;
  eventsOnDay: (d: Date) => CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  today: Date;
}) {
  const firstOfMonth = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-divider bg-surface-alt">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-[10.5px] font-extrabold uppercase tracking-[.04em] text-text-faint">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getMonth() === reference.getMonth();
          const dayEvents = eventsOnDay(day);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex min-h-[104px] flex-col gap-1 border-b border-r border-divider p-1.5 last:border-r-0",
                !inMonth && "bg-surface-alt/40",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11.5px] font-bold",
                  isToday ? "bg-brand-blue text-white" : inMonth ? "text-text" : "text-text-faint",
                )}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-1">
                {dayEvents.slice(0, 3).map((e) => (
                  <EventChip key={e.id} event={e} onSelect={onSelect} />
                ))}
                {dayEvents.length > 3 && (
                  <span className="px-1.5 text-[10px] font-bold text-text-faint">+{dayEvents.length - 3} de plus</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekView({
  reference,
  eventsOnDay,
  onSelect,
  today,
}: {
  reference: Date;
  eventsOnDay: (d: Date) => CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  today: Date;
}) {
  const start = startOfWeek(reference);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {days.map((day) => {
        const dayEvents = eventsOnDay(day);
        const isToday = isSameDay(day, today);
        return (
          <Card key={day.toISOString()} className={cn("flex flex-col gap-2 p-3", isToday && "border-brand-blue")}>
            <div className="text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
              {day.toLocaleDateString("fr-FR", { weekday: "short" })}
            </div>
            <div className={cn("text-[15px] font-extrabold", isToday && "text-brand-blue-electric")}>{day.getDate()}</div>
            <div className="flex flex-col gap-1.5">
              {dayEvents.length === 0 && <span className="text-[11px] text-text-faint">—</span>}
              {dayEvents.map((e) => (
                <EventChip key={e.id} event={e} onSelect={onSelect} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function DayView({ reference, events, onSelect }: { reference: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  return (
    <Card className="flex flex-col divide-y divide-divider">
      {events.length === 0 && (
        <EmptyState title="Aucun événement" description={`Aucun événement le ${reference.toLocaleDateString("fr-FR")}.`} />
      )}
      {events.map((e) => (
        <button key={e.id} onClick={() => onSelect(e)} className="flex items-center gap-3.5 px-5 py-3.5 text-left hover:bg-row-hover">
          <span className="w-14 flex-none text-[12.5px] font-extrabold text-text-soft">
            {e.allDay ? "Journée" : new Date(e.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className={cn("h-2 w-2 flex-none rounded-full", KIND_DOT[e.kind])} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold">{e.title}</span>
            <span className="text-[12px] text-text-soft">{CALENDAR_EVENT_KIND_LABELS[e.kind]}{e.location ? ` · ${e.location}` : ""}</span>
          </span>
        </button>
      ))}
    </Card>
  );
}

function ListView({
  events,
  onSelect,
  today,
}: {
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  today: Date;
}) {
  const upcoming = events.filter((e) => new Date(e.startsAt).getTime() >= today.getTime() - 86_400_000);
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of upcoming) {
    const label = new Date(e.startsAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    groups.set(label, [...(groups.get(label) ?? []), e]);
  }

  if (upcoming.length === 0) {
    return (
      <Card>
        <EmptyState title="Aucun événement à venir" description="Les prochains événements de votre calendrier apparaîtront ici." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {Array.from(groups.entries()).map(([label, dayEvents]) => (
        <div key={label} className="flex flex-col gap-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[.09em] text-text-faint">{label}</div>
          <Card className="divide-y divide-divider">
            {dayEvents.map((e) => (
              <button key={e.id} onClick={() => onSelect(e)} className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left hover:bg-row-hover">
                <span className="w-14 flex-none text-[12.5px] font-extrabold text-text-soft">
                  {e.allDay ? "Journée" : new Date(e.startsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={cn("h-2 w-2 flex-none rounded-full", KIND_DOT[e.kind])} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{e.title}</span>
                  <span className="text-[12px] text-text-soft">{CALENDAR_EVENT_KIND_LABELS[e.kind]}{e.location ? ` · ${e.location}` : ""}</span>
                </span>
              </button>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
