import type { ServiceHistoryEntry } from "@/lib/types/services";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function HistoryTab({ history }: { history: ServiceHistoryEntry[] }) {
  const sorted = [...history].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="flex flex-col gap-0">
      {sorted.map((entry, i) => (
        <div key={entry.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand-blue-electric" />
            {i < sorted.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className="pb-5">
            <div className="text-[13px] font-bold text-text">{entry.label}</div>
            <div className="mt-0.5 text-[11.5px] text-text-faint">
              {entry.actorName} · {formatDateTime(entry.createdAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
