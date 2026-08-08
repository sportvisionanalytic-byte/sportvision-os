import { Check } from "lucide-react";
import type { Service } from "@/lib/types/services";
import { addMinutesToTime } from "@/lib/types/services";

// Déroulé heure par heure — voir ACTIONS.md § 12 (onglet Planning). Les trois blocs
// (installation, captation, débrief) sont dérivés des horaires de la prestation, faute de
// grille horaire détaillée dans le modèle de données.
export function PlanningTab({ service }: { service: Service }) {
  const schedule = [
    { label: "Installation du matériel", time: addMinutesToTime(service.startTime, -30) },
    { label: "Captation", time: service.startTime },
    { label: "Fin de captation", time: service.endTime },
    { label: "Débrief et rangement", time: addMinutesToTime(service.endTime, 15) },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div>
        <div className="text-[13px] font-extrabold tracking-tight">Déroulé du jour</div>
        <div className="mt-3 flex flex-col gap-0">
          {schedule.map((item, i) => (
            <div key={item.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-brand-blue text-[10px] font-extrabold text-brand-blue">
                  {i + 1}
                </span>
                {i < schedule.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden />}
              </div>
              <div className="pb-5">
                <div className="font-mono text-[12px] font-bold text-brand-blue-electric">{item.time}</div>
                <div className="text-[13.5px] font-semibold text-text">{item.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[13px] font-extrabold tracking-tight">Jalons</div>
        <div className="mt-3 flex flex-col gap-2.5">
          {service.milestones
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-alt px-3 py-2.5">
                <span
                  className={
                    m.completedAt
                      ? "flex h-6 w-6 flex-none items-center justify-center rounded-full bg-success-bg text-success-fg"
                      : "flex h-6 w-6 flex-none items-center justify-center rounded-full border border-border-strong text-text-faint"
                  }
                >
                  {m.completedAt && <Check className="h-3.5 w-3.5" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-text">{m.label}</span>
                  <span className="block text-[11.5px] text-text-faint">
                    {m.completedAt ? "Terminé" : `Prévu le ${m.dueDate}`}
                  </span>
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
