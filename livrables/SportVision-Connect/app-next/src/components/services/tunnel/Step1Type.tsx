import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  SERVICE_TYPE_DESCRIPTIONS,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPE_BASE_PRICE,
  formatServicePrice,
  type ServiceType,
} from "@/lib/types/services";

const SERVICE_TYPES = Object.keys(SERVICE_TYPE_LABELS) as ServiceType[];

export function Step1Type({
  value,
  onChange,
}: {
  value: ServiceType | null;
  onChange: (type: ServiceType) => void;
}) {
  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Quel type de prestation ?</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">Choisissez le format le plus proche de votre besoin.</p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_TYPES.map((type) => {
          const active = value === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChange(type)}
              aria-pressed={active}
              className={cn(
                "flex flex-col gap-2 rounded-sv-card border p-4 text-left transition-[transform,border-color,box-shadow] duration-sv hover:-translate-y-0.5",
                active
                  ? "border-brand-blue bg-info-bg shadow-sv-card-hover"
                  : "border-border bg-surface hover:border-brand-blue-pale",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[14px] font-extrabold tracking-tight text-text">
                  {SERVICE_TYPE_LABELS[type]}
                </span>
                {active && (
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue to-brand-violet text-white">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                )}
              </div>
              <p className="text-[12.5px] leading-relaxed text-text-soft">{SERVICE_TYPE_DESCRIPTIONS[type]}</p>
              <span className="mt-auto text-[12px] font-bold text-text-faint">
                À partir de {formatServicePrice(SERVICE_TYPE_BASE_PRICE[type])}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
