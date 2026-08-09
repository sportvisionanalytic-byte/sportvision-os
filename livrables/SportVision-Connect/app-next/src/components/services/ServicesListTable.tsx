import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { Service } from "@/lib/types/services";
import {
  SERVICE_STATUS_LABELS,
  SERVICE_STATUS_TONE,
  SERVICE_TYPE_LABELS,
  formatServiceDate,
  formatServicePriceOrPending,
} from "@/lib/types/services";

// Vue liste des prestations — voir ACTIONS.md § 12 (« Kanban et Liste »). Sous 760 px, les
// en-têtes de tableau sont masqués et chaque ligne devient une carte (CHARTE.md § Responsive).
export function ServicesListTable({ services }: { services: Service[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_1fr] gap-3 border-b border-divider bg-bg-alt px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:grid">
        <span>Prestation</span>
        <span>Date</span>
        <span>Statut</span>
        <span>Montant</span>
        <span className="text-right">Référence</span>
      </div>
      {services.map((service) => (
        <Link
          key={service.id}
          href={`/services/${service.id}`}
          className="grid grid-cols-1 gap-1.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover sm:grid-cols-[1.6fr_1fr_1fr_1fr_1fr] sm:items-center sm:gap-3"
        >
          <span className="truncate text-[13.5px] font-bold text-text">{SERVICE_TYPE_LABELS[service.serviceType]}</span>
          <span className="text-[12.5px] text-text-soft">{formatServiceDate(service.date)}</span>
          <span>
            <Badge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABELS[service.status]}</Badge>
          </span>
          <span className="text-[12.5px] font-bold text-text">{formatServicePriceOrPending(service.totalPrice)}</span>
          <span className="font-mono text-[11px] text-text-faint sm:text-right">{service.reference}</span>
        </Link>
      ))}
    </Card>
  );
}
