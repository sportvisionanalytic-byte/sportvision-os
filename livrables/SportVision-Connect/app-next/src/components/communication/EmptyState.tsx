import type { LucideIcon } from "lucide-react";

// États vides — README.md § États vides : ils guident vers l'action, ils ne constatent pas
// l'absence.
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-sv-card border border-dashed border-border-strong px-8 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-text-faint">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-[15px] font-extrabold tracking-tight">{title}</p>
      {subtitle && <p className="max-w-[360px] text-[13px] leading-relaxed text-text-soft">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
