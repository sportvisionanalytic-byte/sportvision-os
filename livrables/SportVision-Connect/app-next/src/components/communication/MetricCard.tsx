"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

// Tuile de métrique réutilisée par le dashboard Full Communication (4 cartes de la semaine) et
// par /analytics (4 métriques + progression) — ACTIONS.md § 5 et § 9. Composant propre au
// module, pas dans src/components/ui (README.md § Conventions point 3).
export function MetricCard({
  icon: Icon,
  label,
  value,
  deltaPct,
  hint,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Progression en %, positive ou négative. Omis = pas d'indicateur de tendance. */
  deltaPct?: number;
  hint?: string;
  className?: string;
}) {
  const trendUp = typeof deltaPct === "number" && deltaPct >= 0;
  return (
    <Card className={cn("p-4 transition-transform duration-sv hover:-translate-y-0.5", className)}>
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-info-bg text-info-fg">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {typeof deltaPct === "number" && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold",
              trendUp ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg",
            )}
          >
            {trendUp ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
            {trendUp ? "+" : ""}
            {deltaPct}%
          </span>
        )}
      </div>
      <div className="mt-3 text-[24px] font-extrabold leading-tight tracking-tight">{value}</div>
      <div className="mt-0.5 text-[12.5px] font-semibold text-text-soft">{label}</div>
      {hint && <div className="mt-1.5 text-[11.5px] text-text-faint">{hint}</div>}
    </Card>
  );
}
