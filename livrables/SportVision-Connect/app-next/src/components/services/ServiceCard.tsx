import Link from "next/link";
import { Calendar, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { Service } from "@/lib/types/services";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_TONE, SERVICE_TYPE_LABELS, formatServiceDateShort, formatServicePrice } from "@/lib/types/services";

// Carte de prestation — utilisée par le kanban (colonne) et par la vue liste en mobile.
// Voir ACTIONS.md § 12.
export function ServiceCard({ service }: { service: Service }) {
  return (
    <Link href={`/services/${service.id}`}>
      <Card className="flex flex-col gap-2.5 p-3.5 hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-medium text-text-faint">{service.reference}</span>
          <Badge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABELS[service.status]}</Badge>
        </div>
        <div className="text-[13.5px] font-bold leading-snug text-text">{SERVICE_TYPE_LABELS[service.serviceType]}</div>
        <div className="flex items-center gap-1.5 text-[12px] text-text-soft">
          <Calendar className="h-3.5 w-3.5 flex-none" aria-hidden />
          {formatServiceDateShort(service.date)} · {service.startTime}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[12px] text-text-soft">
          <MapPin className="h-3.5 w-3.5 flex-none" aria-hidden />
          <span className="truncate">{service.address}</span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-divider pt-2.5">
          <span className="text-[12.5px] font-extrabold text-text">{formatServicePrice(service.totalPrice)}</span>
          {service.progressPercent > 0 && (
            <span className="text-[11px] font-bold text-text-faint">{service.progressPercent}%</span>
          )}
        </div>
      </Card>
    </Link>
  );
}
