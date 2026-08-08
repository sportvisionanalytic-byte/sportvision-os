import { Calendar, Clock, MapPin, Phone, User } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Service } from "@/lib/types/services";
import {
  SERVICE_STATUS_LABELS,
  SERVICE_STATUS_TONE,
  SERVICE_TYPE_LABELS,
  formatServiceDate,
  formatServicePrice,
} from "@/lib/types/services";

export function ResumeTab({ service }: { service: Service }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-4">
        <div className="rounded-sv-card border border-border bg-surface-alt p-4">
          <div className="text-[13px] font-extrabold tracking-tight">Détails</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoLine icon={Calendar} label="Date" value={formatServiceDate(service.date)} />
            <InfoLine icon={Clock} label="Horaires" value={`${service.startTime} – ${service.endTime}`} />
            <InfoLine icon={MapPin} label="Adresse" value={service.address} />
            <InfoLine icon={User} label="Contact sur place" value={service.onSiteContactName} />
            <InfoLine icon={Phone} label="Téléphone" value={service.onSiteContactPhone} />
          </div>
        </div>

        <div className="rounded-sv-card border border-border bg-surface-alt p-4">
          <div className="text-[13px] font-extrabold tracking-tight">Objectif</div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">{service.brief.objective}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-sv-card border border-border bg-surface-alt p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-extrabold tracking-tight">Statut</span>
            <Badge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABELS[service.status]}</Badge>
          </div>
          <div className="mt-3 text-[12.5px] text-text-soft">{SERVICE_TYPE_LABELS[service.serviceType]}</div>
          {service.progressPercent > 0 && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet transition-[width] duration-300 ease-out"
                  style={{ width: `${service.progressPercent}%` }}
                />
              </div>
              <div className="mt-1 text-right text-[11px] font-bold text-text-faint">{service.progressPercent}% réalisé</div>
            </div>
          )}
        </div>

        <div className="rounded-sv-card border border-border bg-surface-alt p-4">
          <div className="text-[13px] font-extrabold tracking-tight">Montant</div>
          <div className="mt-2 text-[22px] font-extrabold tracking-tight">{formatServicePrice(service.totalPrice)}</div>
          <div className="mt-1 text-[12px] text-text-soft">
            Acompte {formatServicePrice(service.depositAmount)}
            {service.depositPaidAt ? " · réglé" : " · en attente"}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoLine({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span>
        <span className="block text-[11px] font-bold uppercase tracking-[.03em] text-text-faint">{label}</span>
        <span className="block text-[13px] font-semibold text-text">{value}</span>
      </span>
    </div>
  );
}
