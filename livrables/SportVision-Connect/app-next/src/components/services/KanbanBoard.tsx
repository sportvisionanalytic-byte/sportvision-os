import { KANBAN_COLUMNS, getKanbanColumnKey } from "@/lib/types/services";
import type { Service } from "@/lib/types/services";
import { ServiceCard } from "./ServiceCard";

// Kanban des prestations — colonnes fixes, voir ACTIONS.md § 12. `terminee` et `annulee`
// sortent du pilotage actif (voir la note dans lib/types/services.ts) : elles restent
// consultables via la vue Liste.
export function KanbanBoard({ services }: { services: Service[] }) {
  return (
    <div className="flex gap-3.5 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((column) => {
        const cards = services.filter((s) => getKanbanColumnKey(s.status) === column.key);
        return (
          <div key={column.key} className="flex w-[280px] flex-none flex-col gap-3 rounded-sv-panel bg-surface-alt p-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-[12.5px] font-extrabold tracking-tight text-text">{column.label}</span>
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-sunken px-1.5 text-[11px] font-extrabold text-text-soft">
                {cards.length}
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {cards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-strong px-3 py-6 text-center text-[12px] text-text-faint">
                  Aucune prestation
                </div>
              ) : (
                cards.map((service) => <ServiceCard key={service.id} service={service} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
