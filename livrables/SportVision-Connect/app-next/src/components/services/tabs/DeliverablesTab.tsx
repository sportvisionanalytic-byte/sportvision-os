import { Package } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Deliverable, DeliverableStatus } from "@/lib/types/services";
import { DELIVERABLE_STATUS_LABELS } from "@/lib/types/services";

const DELIVERABLE_TONE: Record<DeliverableStatus, BadgeTone> = {
  planned: "neutral",
  option_selected: "info",
  in_production: "accent",
  delivered: "success",
};

export function DeliverablesTab({ deliverables }: { deliverables: Deliverable[] }) {
  if (deliverables.length === 0) {
    return <EmptyState variant="compact" title="Aucun livrable prévu pour le moment" className="py-8 text-[12.5px]" />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {deliverables.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-sv-card border border-border bg-surface-alt p-3.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
            <Package className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold text-text">{d.label}</span>
            {d.quantity && <span className="block text-[11.5px] text-text-faint">Quantité : {d.quantity}</span>}
          </span>
          <Badge tone={DELIVERABLE_TONE[d.status]}>{DELIVERABLE_STATUS_LABELS[d.status]}</Badge>
        </div>
      ))}
    </div>
  );
}
