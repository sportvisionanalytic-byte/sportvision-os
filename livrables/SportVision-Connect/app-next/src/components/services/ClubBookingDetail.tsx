"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_TONE, BOOKING_STEPS, type ClubBooking } from "@/lib/types/club-bookings";

function formatDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// Panneau de suivi — port de drawerHtml() (référence vanille club-services-documents-rapports.js) :
// pipeline terrain à 6 étapes, piloté par le staff SportVision côté SportVision OS (voir
// migration-connect-v34-club-bookings-staff-access.sql), jamais par le club lui-même. "Contacter
// le support" pointe vers /support (route réelle de Connect), pas un toast d'attente comme la
// référence vanille — l'équivalent réel existe déjà ici, inutile de feindre son absence.
export function ClubBookingDetail({ booking, onClose }: { booking: ClubBooking; onClose: () => void }) {
  const activeIndex = BOOKING_STEPS.indexOf(booking.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="animate-svfade h-full w-full max-w-md overflow-y-auto border-l border-border bg-elevated p-6 shadow-sv-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[18px] font-extrabold tracking-tight">{booking.serviceLabel}</div>
            <div className="mt-1 text-[12.5px] text-text-soft">
              {booking.team ?? "—"} · {formatDate(booking.eventDate)}
            </div>
          </div>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border-strong text-text-soft"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3">
          <Badge tone={BOOKING_STATUS_TONE[booking.status]}>{BOOKING_STATUS_LABEL[booking.status]}</Badge>
        </div>

        <div className="mt-3 text-[16px] font-extrabold text-text">{booking.priceLabel ?? "Sur devis"}</div>

        {booking.adresse && <div className="mt-2 text-[12.5px] text-text-soft">Lieu : {booking.adresse}</div>}

        <div className="mt-5 text-[11px] font-extrabold uppercase tracking-wide text-text-faint">
          Pipeline terrain
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          {BOOKING_STEPS.map((step, i) => {
            const on = activeIndex >= 0 && i <= activeIndex;
            return (
              <div key={step} className="flex items-center gap-2.5">
                <span className={cn("h-2 w-2 flex-none rounded-full", on ? "bg-brand-blue-electric" : "bg-border-strong")} />
                <span className={cn("text-[12.5px]", on ? "font-bold text-text" : "text-text-soft")}>
                  {BOOKING_STATUS_LABEL[step]}
                </span>
              </div>
            );
          })}
        </div>

        <Link href="/support" className="mt-6 block">
          <Button variant="secondary" className="w-full">
            Contacter le support
          </Button>
        </Link>
      </div>
    </div>
  );
}
