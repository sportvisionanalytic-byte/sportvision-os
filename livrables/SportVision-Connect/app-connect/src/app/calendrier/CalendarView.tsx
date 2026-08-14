"use client";

import { useMemo, useState } from "react";
import { downloadIcsEvent } from "@/lib/ics";

export interface CalendarEventData {
  id: string;
  /** match | entrainement | tournoi | contenu | sponsor | prestation | rendez_vous */
  kind: string;
  title: string;
  /** ISO YYYY-MM-DD */
  date: string;
  /** HH:MM:SS ou null (heure non communiquée) */
  time: string | null;
  location: string | null;
  clubName: string | null;
  teamName: string | null;
}

const TYPE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  match: { label: "Match", color: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
  entrainement: { label: "Entraînement", color: "#C7C7DE", bg: "rgba(255,255,255,.08)" },
  tournoi: { label: "Tournoi", color: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  contenu: { label: "Événement SportVision", color: "#C084FC", bg: "rgba(168,85,247,.16)" },
  sponsor: { label: "Sponsor", color: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  prestation: { label: "Prestation", color: "#8CA9FF", bg: "rgba(79,125,255,.16)" },
  rendez_vous: { label: "Rendez-vous", color: "#F472B6", bg: "rgba(244,114,182,.14)" },
};

function badgeFor(kind: string) {
  return TYPE_BADGES[kind] ?? { label: "Événement", color: "#9A9AB8", bg: "rgba(255,255,255,.08)" };
}

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function formatDayMonth(iso: string): { day: string; month: string } {
  const d = parseDate(iso);
  return {
    day: d.getDate().toString(),
    month: d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""),
  };
}

function formatFullDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatTime(time: string | null): string | null {
  if (!time) return null;
  return time.slice(0, 5);
}

function startOfWeek(d: Date): Date {
  const n = startOfDay(d);
  const day = n.getDay();
  const diff = day === 0 ? -6 : 1 - day; // lundi = premier jour
  n.setDate(n.getDate() + diff);
  return n;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

type View = "mois" | "semaine" | "liste";

export function CalendarView({ events, hasClub }: { events: CalendarEventData[]; hasClub: boolean }) {
  const [view, setView] = useState<View>("liste");
  const [monthCursor, setMonthCursor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<CalendarEventData | null>(null);

  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))),
    [events],
  );

  const today = startOfDay(new Date());
  const upcoming = sorted.filter((e) => parseDate(e.date) >= today);

  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + (7 - today.getDay() === 0 ? 7 : 7 - today.getDay()));
  const cetteSemaine = upcoming.filter((e) => parseDate(e.date) <= weekEnd);
  const plusTard = upcoming.filter((e) => parseDate(e.date) > weekEnd);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Calendrier</h1>
        <p className="text-[15px] text-text-tertiary">Vos événements et prestations SportVision.</p>
      </div>

      <div className="hidden gap-2 lg:flex">
        {(
          [
            { key: "mois", label: "Mois" },
            { key: "semaine", label: "Semaine" },
            { key: "liste", label: "Liste" },
          ] as { key: View; label: string }[]
        ).map((t) => {
          const active = view === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              className="rounded-sv-pill px-4 py-2.5 text-[14px] font-medium transition-colors duration-150"
              style={{
                color: active ? "#8CA9FF" : "#C7C7DE",
                background: active ? "rgba(79,125,255,.16)" : "rgba(255,255,255,.05)",
                border: `1px solid ${active ? "rgba(140,169,255,.4)" : "rgba(255,255,255,.09)"}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {events.length === 0 ? (
        <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-prestations-bg">
            <span className="material-symbols-rounded !text-[24px] text-prestations">event</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">Aucun événement SportVision prévu</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            {hasClub
              ? "Les prochains événements et rendez-vous liés à votre club apparaîtront ici."
              : "Rejoignez votre club pour retrouver ici son calendrier SportVision."}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile : toujours "À venir" */}
          <div className="flex flex-col gap-6 lg:hidden">
            <EventGroups groups={[{ title: "Cette semaine", events: cetteSemaine }, { title: "Plus tard", events: plusTard }]} onSelect={setSelected} />
          </div>

          {/* Desktop */}
          <div className="hidden lg:block">
            {view === "liste" && (
              <EventGroups groups={[{ title: "Cette semaine", events: cetteSemaine }, { title: "Plus tard", events: plusTard }]} onSelect={setSelected} />
            )}
            {view === "semaine" && <WeekView events={sorted} onSelect={setSelected} />}
            {view === "mois" && (
              <MonthView cursor={monthCursor} onCursorChange={setMonthCursor} events={sorted} onSelect={setSelected} />
            )}
          </div>
        </>
      )}

      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EventGroups({
  groups,
  onSelect,
}: {
  groups: { title: string; events: CalendarEventData[] }[];
  onSelect: (e: CalendarEventData) => void;
}) {
  const visible = groups.filter((g) => g.events.length > 0);
  if (visible.length === 0) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
        <span className="font-sora text-[16px] font-semibold">Rien à venir pour le moment</span>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Aucun événement SportVision prévu sur cette période.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {visible.map((group) => (
        <div key={group.title} className="flex flex-col gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{group.title}</span>
          <div className="flex flex-col gap-2.5">
            {group.events.map((ev) => {
              const badge = badgeFor(ev.kind);
              const { day, month } = formatDayMonth(ev.date);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onSelect(ev)}
                  className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-4 text-left transition-colors duration-150 hover:bg-surface-hover"
                >
                  <div className="flex h-14 w-14 flex-none flex-col items-center justify-center rounded-sv" style={{ background: badge.bg }}>
                    <span className="font-sora text-[19px] font-bold leading-none">{day}</span>
                    <span className="text-[10px] font-medium uppercase" style={{ color: badge.color }}>
                      {month}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-sora text-[16px] font-semibold tracking-tight">{ev.title}</span>
                    <span className="text-[13px] text-text-tertiary">
                      {[formatTime(ev.time), ev.location, ev.teamName].filter(Boolean).join(" · ") || ev.clubName || ""}
                    </span>
                  </div>
                  <span
                    className="ml-auto flex-none rounded-sv-pill px-2.5 py-1 text-[11px] font-medium"
                    style={{ color: badge.color, background: badge.bg }}
                  >
                    {badge.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeekView({ events, onSelect }: { events: CalendarEventData[]; onSelect: (e: CalendarEventData) => void }) {
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + i);
    return d;
  });
  const firstDay = days[0] ?? cursor;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="font-sora text-[16px] font-semibold">
          Semaine du {firstDay.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
        </span>
        <div className="ml-auto flex gap-2">
          <NavButton
            icon="chevron_left"
            onClick={() => setCursor((c) => { const n = new Date(c); n.setDate(n.getDate() - 7); return n; })}
          />
          <NavButton
            icon="chevron_right"
            onClick={() => setCursor((c) => { const n = new Date(c); n.setDate(n.getDate() + 7); return n; })}
          />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const iso = isoOf(d);
          const dayEvents = events.filter((e) => e.date === iso);
          const isToday = iso === isoOf(new Date());
          return (
            <div key={iso} className="flex min-h-[140px] flex-col gap-2 rounded-sv border border-border bg-surface p-2.5">
              <span className={`text-[12px] font-medium ${isToday ? "text-prestations" : "text-text-tertiary"}`}>
                {d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}
              </span>
              <div className="flex flex-col gap-1.5">
                {dayEvents.map((ev) => {
                  const badge = badgeFor(ev.kind);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onSelect(ev)}
                      className="truncate rounded-[7px] px-1.5 py-1 text-left text-[11px] font-medium"
                      style={{ color: badge.color, background: badge.bg }}
                      title={ev.title}
                    >
                      {ev.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({
  cursor,
  onCursorChange,
  events,
  onSelect,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  events: CalendarEventData[];
  onSelect: (e: CalendarEventData) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = startOfWeek(firstOfMonth);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayIso = isoOf(new Date());
  const weekDayLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5">
        <span className="font-sora text-[19px] font-semibold capitalize tracking-tight">
          {cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
        </span>
        <div className="ml-auto flex gap-2">
          <NavButton icon="chevron_left" onClick={() => onCursorChange(new Date(year, month - 1, 1))} />
          <NavButton icon="chevron_right" onClick={() => onCursorChange(new Date(year, month + 1, 1))} />
        </div>
      </div>
      <div className="rounded-sv-card border border-border bg-surface p-4">
        <div className="mb-2 grid grid-cols-7 gap-1.5">
          {weekDayLabels.map((wd) => (
            <span key={wd} className="text-center text-[11px] font-medium uppercase tracking-[.06em] text-text-label">
              {wd}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((d) => {
            const iso = isoOf(d);
            const inMonth = d.getMonth() === month;
            const dayEvents = events.filter((e) => e.date === iso);
            const isToday = iso === todayIso;
            return (
              <div
                key={iso}
                className="flex min-h-[64px] flex-col gap-1 rounded-[12px] border p-1.5"
                style={{
                  background: isToday ? "rgba(140,169,255,.1)" : "rgba(255,255,255,.02)",
                  borderColor: isToday ? "rgba(140,169,255,.4)" : "rgba(255,255,255,.06)",
                  opacity: inMonth ? 1 : 0.35,
                }}
              >
                <span className="text-[12px] font-medium">{d.getDate()}</span>
                {dayEvents.slice(0, 2).map((ev) => {
                  const badge = badgeFor(ev.kind);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onSelect(ev)}
                      className="truncate rounded-[5px] px-1 py-0.5 text-left text-[10px] font-medium"
                      style={{ color: badge.color, background: badge.bg }}
                      title={ev.title}
                    >
                      {ev.title}
                    </button>
                  );
                })}
                {dayEvents.length > 2 && (
                  <span className="text-[10px] text-text-label">+{dayEvents.length - 2}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NavButton({ icon, onClick }: { icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[38px] w-[38px] items-center justify-center rounded-sv border border-border bg-surface text-text-secondary hover:bg-surface-hover"
    >
      <span className="material-symbols-rounded !text-[19px]">{icon}</span>
    </button>
  );
}

function EventDetail({ event, onClose }: { event: CalendarEventData; onClose: () => void }) {
  const badge = badgeFor(event.kind);
  const facts: { icon: string; label: string; value: string }[] = [
    { icon: "calendar_today", label: "Date", value: formatFullDate(event.date) },
  ];
  if (event.time) facts.push({ icon: "schedule", label: "Horaire", value: formatTime(event.time)! });
  if (event.location) facts.push({ icon: "location_on", label: "Lieu", value: event.location });
  if (event.clubName) facts.push({ icon: "shield", label: "Affiliation", value: event.clubName });
  if (event.teamName) facts.push({ icon: "groups", label: "Équipe", value: event.teamName });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-4 sm:p-6" onClick={onClose}>
      <div
        className="flex w-full max-w-[520px] max-h-[85vh] flex-col gap-5 overflow-y-auto rounded-sv-modal border border-border bg-bg-elevated p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="rounded-sv-pill px-2.5 py-1 text-[11px] font-medium" style={{ color: badge.color, background: badge.bg }}>
            {badge.label}
          </span>
          <button type="button" onClick={onClose} className="ml-auto flex h-9 w-9 items-center justify-center rounded-sv bg-white/[.06] hover:bg-white/[.12]">
            <span className="material-symbols-rounded !text-[19px]">close</span>
          </button>
        </div>
        <h2 className="font-sora text-[22px] font-bold tracking-tight">{event.title}</h2>
        <div className="flex flex-col gap-3">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-sv bg-white/[.06]">
                <span className="material-symbols-rounded !text-[18px] text-prestations">{f.icon}</span>
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-text-faint">{f.label}</span>
                <span className="text-[14px] font-medium">{f.value}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            downloadIcsEvent({
              uid: event.id,
              title: event.title,
              date: event.date,
              time: event.time,
              location: event.location,
              description: event.clubName ? `SportVision · ${event.clubName}` : "SportVision",
            })
          }
          className="flex h-[50px] items-center justify-center gap-2 self-start rounded-sv border border-border-strong bg-surface px-5 font-sora text-[15px] font-semibold hover:bg-surface-hover"
        >
          <span className="material-symbols-rounded !text-[19px]">event</span>
          Ajouter à mon calendrier
        </button>
      </div>
    </div>
  );
}
