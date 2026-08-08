"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { CalendarEventKind } from "@/lib/types/calendar";
import { CALENDAR_EVENT_KIND_LABELS } from "@/lib/types/calendar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Modale « Ajouter un événement » — voir ACTIONS.md § 15.
interface AddEventModalProps {
  onClose: () => void;
  onCreate: (event: { title: string; kind: CalendarEventKind; date: string; time: string; location: string }) => void;
}

export function AddEventModal({ onClose, onCreate }: AddEventModalProps) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarEventKind>("meeting");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("");

  const canSubmit = title.trim().length > 0 && date.trim().length > 0;

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
            {Object.entries(CALENDAR_EVENT_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Heure</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Lieu (facultatif)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass} />
        </label>

        <div className="mt-1 flex justify-end">
          <Button
            disabled={!canSubmit}
            onClick={() => {
              onCreate({ title, kind, date, time, location });
              onClose();
            }}
          >
            Ajouter
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
