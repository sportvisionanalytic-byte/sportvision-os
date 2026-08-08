"use client";

import Link from "next/link";
import { CalendarClock, MapPin, Users, X } from "lucide-react";
import type { CalendarEvent } from "@/lib/types/calendar";
import { CALENDAR_EVENT_KIND_LABELS } from "@/lib/types/calendar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KIND_TONE } from "./calendar-style";

// Fiche latérale d'un événement du calendrier — voir ACTIONS.md § 15 : « clic sur un événement →
// fiche latérale ».
interface EventDetailPanelProps {
  event: CalendarEvent;
  onClose: () => void;
}

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-[rgba(7,10,23,.55)]">
      <Card className="animate-svfade flex h-full w-full max-w-[400px] flex-col gap-5 overflow-y-auto rounded-none rounded-l-sv-panel p-6 shadow-sv-panel">
        <div className="flex items-start justify-between gap-3">
          <Badge tone={KIND_TONE[event.kind]}>{CALENDAR_EVENT_KIND_LABELS[event.kind]}</Badge>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <h2 className="text-[20px] font-extrabold leading-tight tracking-tight">{event.title}</h2>

        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-center gap-2.5 text-text-soft">
            <CalendarClock className="h-4 w-4 flex-none" aria-hidden />
            {event.allDay
              ? start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
              : `${start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${end ? ` – ${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
          </div>
          {event.location && (
            <div className="flex items-center gap-2.5 text-text-soft">
              <MapPin className="h-4 w-4 flex-none" aria-hidden />
              {event.location}
            </div>
          )}
          {event.teamName && (
            <div className="flex items-center gap-2.5 text-text-soft">
              <Users className="h-4 w-4 flex-none" aria-hidden />
              {event.teamName}
            </div>
          )}
        </div>

        {event.status && (
          <div className="rounded-xl bg-surface-alt px-3.5 py-2.5 text-[12.5px] font-bold text-text-soft">
            Statut : <span className="text-text">{event.status}</span>
          </div>
        )}

        <div className="mt-auto flex flex-col gap-2.5">
          {event.sourceHref && (
            <Link href={event.sourceHref}>
              <Button className="w-full">Voir la ressource liée</Button>
            </Link>
          )}
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Ajouter à mon calendrier
          </Button>
        </div>
      </Card>
    </div>
  );
}
