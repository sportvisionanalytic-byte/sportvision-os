import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { SERVICE_OPTIONS, formatServicePrice, type ServiceOptionCode } from "@/lib/types/services";

export function Step3Options({
  selected,
  onToggle,
}: {
  selected: ServiceOptionCode[];
  onToggle: (code: ServiceOptionCode) => void;
}) {
  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Options complémentaires</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">Facultatif — ajoutez ce dont vous avez besoin en plus du forfait.</p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SERVICE_OPTIONS.map((option) => {
          const active = selected.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => onToggle(option.code)}
              aria-pressed={active}
              className={cn(
                "flex items-start gap-3 rounded-sv-card border p-4 text-left transition-[transform,border-color,box-shadow] duration-sv hover:-translate-y-0.5",
                active
                  ? "border-brand-blue bg-info-bg shadow-sv-card-hover"
                  : "border-border bg-surface hover:border-brand-blue-pale",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md border-2",
                  active ? "border-brand-blue bg-brand-blue text-white" : "border-border-strong",
                )}
                aria-hidden
              >
                {active && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-extrabold text-text">{option.label}</span>
                  <span className="flex-none text-[13px] font-extrabold text-brand-blue-electric">
                    +{formatServicePrice(option.price)}
                  </span>
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-text-soft">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
