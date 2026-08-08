"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { Modal } from "./Modal";

// /mycm — ACTIONS.md § 9 : « Planifier un échange » (secondaire) ouvre les créneaux
// disponibles. Créneaux fictifs mais réalistes, générés à partir d'aujourd'hui.
function nextSlots(): { label: string; iso: string }[] {
  const days = [2, 3, 5];
  const hours = [10, 14];
  const slots: { label: string; iso: string }[] = [];
  const base = new Date();
  for (const d of days) {
    for (const h of hours) {
      const date = new Date(base);
      date.setDate(date.getDate() + d);
      date.setHours(h, 0, 0, 0);
      slots.push({
        label: date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + ` · ${h}h00`,
        iso: date.toISOString(),
      });
    }
  }
  return slots;
}

export function ScheduleSlotModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (label: string) => void;
}) {
  const [slots] = useState(nextSlots);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Modal open={open} onClose={onClose} title="Planifier un échange">
      <p className="text-[13px] leading-relaxed text-text-soft">Choisissez un créneau avec votre Community Manager.</p>
      <div className="mt-4 flex flex-col gap-2">
        {slots.map((slot) => (
          <button
            key={slot.iso}
            onClick={() => setSelected(slot.iso)}
            className={cn(
              "flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-[13.5px] font-bold capitalize transition-colors",
              selected === slot.iso
                ? "border-brand-blue bg-info-bg text-info-fg"
                : "border-border-strong text-text-soft hover:border-brand-blue-electric",
            )}
          >
            {slot.label}
            {selected === slot.iso && <Check className="h-4 w-4 flex-none" aria-hidden />}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!selected}
          onClick={() => {
            const slot = slots.find((s) => s.iso === selected);
            if (slot) onConfirm(slot.label);
          }}
        >
          Confirmer le créneau
        </Button>
      </div>
    </Modal>
  );
}
