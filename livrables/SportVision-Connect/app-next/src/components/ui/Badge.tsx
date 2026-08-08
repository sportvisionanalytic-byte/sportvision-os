import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// StatusChip — voir CHARTE.md § Badges de statut. Toujours couleur + libellé texte,
// jamais la couleur seule.
export type BadgeTone = "success" | "warning" | "danger" | "info" | "accent" | "cyan" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  info: "bg-info-bg text-info-fg",
  accent: "bg-accent-bg text-accent-fg",
  cyan: "bg-cyan-bg text-cyan-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
}

export function Badge({ tone, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
