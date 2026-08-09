"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { CalendarEventKind } from "@/lib/types/calendar";
import { CALENDAR_EVENT_KIND_LABELS } from "@/lib/types/calendar";
import { CREATABLE_EVENT_TYPE_MAP } from "@/lib/data/club/calendar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Modale « Ajouter un événement » — voir ACTIONS.md § 15. Champs Heure/Lieu réintégrés le
// 09/08/2026 : migration-clubplus-v35-calendar-event-heure-lieu.sql (exécutée par Fouka) ajoute
// event_time/location à club_calendar_events. Le type proposé reste limité aux 6 valeurs couvertes
// par CREATABLE_EVENT_TYPE_MAP (contrainte check réelle sur club_calendar_events.type) : les 4
// autres types du design (Publication, Échéance de contrat, Échéance de facture, Stage) n'ont pas
// d'équivalent réel et retombaient silencieusement sur "Tournage" en base.
interface AddEventModalProps {
  onClose: () => void;
  onCreate: (event: { title: string; kind: CalendarEventKind; date: string; time?: string; location?: string }) => Promise<unknown>;
}

const CREATABLE_KINDS = Object.keys(CREATABLE_EVENT_TYPE_MAP) as CalendarEventKind[];

export function AddEventModal({ onClose, onCreate }: AddEventModalProps) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarEventKind>("meeting");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && date.trim().length > 0;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    onCreate({ title, kind, date, time: time || undefined, location: location || undefined })
      .then(() => onClose())
      .catch(() => {
        setSubmitting(false);
        setError("Impossible de créer l'événement. Réessayez.");
      });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[440px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Ajouter un événement</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Titre</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} placeholder="Réunion staff" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as CalendarEventKind)} className={fieldClass}>
            {CREATABLE_KINDS.map((value) => (
              <option key={value} value={value}>
                {CALENDAR_EVENT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Heure (optionnel)</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Lieu (optionnel)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass} placeholder="Stade municipal" />
        </label>

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
            Ajouter
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
