import type { ReactNode } from "react";
import { Lock } from "lucide-react";

// Bibliothèque de blocs génériques pour les écrans de démo Club+ (/demo/*) — voir
// src/lib/demo/content.tsx pour leur usage. Objectif : un rendu visuellement cohérent avec la
// charte réelle (mêmes tokens Tailwind que les écrans (app)/*) sans reproduire 34 composants
// bespoke, puisque le contenu de démo est statique par construction (voir profiles.ts).

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-extrabold tracking-tight text-text sm:text-[26px]">{title}</h1>
        {subtitle && <p className="max-w-[620px] text-[13.5px] leading-relaxed text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatGrid({ stats }: { stats: { label: string; value: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-sv-card border border-border bg-surface p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint">{s.label}</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-text">{s.value}</div>
          {s.hint && <div className="mt-1 text-[12px] text-text-faint">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-sv-card border border-border bg-surface p-5">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-bold text-text">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent" }) {
  const toneClass: Record<string, string> = {
    neutral: "bg-neutral-bg text-neutral-fg",
    success: "bg-success-bg text-success-fg",
    warning: "bg-warning-bg text-warning-fg",
    danger: "bg-danger-bg text-danger-fg",
    info: "bg-info-bg text-info-fg",
    accent: "bg-accent-bg text-accent-fg",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${toneClass[tone]}`}>{label}</span>;
}

export interface RowSpec {
  primary: string;
  secondary?: string;
  meta?: string;
  badge?: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent" };
}

export function RowList({ rows }: { rows: RowSpec[] }) {
  return (
    <div className="flex flex-col divide-y divide-divider">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-text">{r.primary}</div>
            {r.secondary && <div className="truncate text-[12.5px] text-text-secondary">{r.secondary}</div>}
          </div>
          <div className="flex flex-none items-center gap-2.5">
            {r.meta && <span className="text-[12px] text-text-faint">{r.meta}</span>}
            {r.badge && <Badge label={r.badge.label} tone={r.badge.tone} />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[.05em] text-text-faint">
            {columns.map((c) => (
              <th key={c} className="py-2 pr-4 font-bold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-divider last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="py-2.5 pr-4 text-text">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="rounded-sv-card border border-dashed border-border p-6 text-center text-[13px] text-text-faint">{label}</div>;
}

export function LockedModule({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sv-card border border-border bg-surface px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg">
        <Lock className="h-5 w-5 text-text-faint" aria-hidden />
      </span>
      <h2 className="text-[16px] font-bold text-text">{title}</h2>
      <p className="max-w-[420px] text-[13px] leading-relaxed text-text-secondary">{reason}</p>
    </div>
  );
}

export function MessageBubble({ from, text, time }: { from: "moi" | "sportvision"; text: string; time: string }) {
  const mine = from === "moi";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-sv px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
          mine ? "text-white" : "border border-border bg-surface text-text"
        }`}
        style={mine ? { background: "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)" } : undefined}
      >
        <p>{text}</p>
        <span className={`mt-1 block text-[10.5px] ${mine ? "text-white/70" : "text-text-faint"}`}>{time}</span>
      </div>
    </div>
  );
}
