"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { mockNotifications } from "@/lib/mock/settings";
import { NOTIFICATION_CATEGORY_LABELS, type AppNotification, type NotificationCategory } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

// /notifications — voir ACTIONS.md § 23. Regroupement par jour, filtres par catégorie, non lues
// sur fond teinté avec point bleu, badge « IMPORTANT » sur les épinglées, Tout marquer comme lu.
//
// Pas de garde `canAccess` ici : "notifications" n'existe pas dans `ModuleKey` (src/lib/types.ts)
// — c'est une fonctionnalité de compte personnelle, non liée à l'offre de l'organisation, au même
// titre que /auth ou /signup. Voir aussi /notifications/preferences pour la même décision.
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

const CATEGORY_FILTERS: (NotificationCategory | "all")[] = [
  "all",
  "content",
  "requests",
  "payments",
  "contracts",
  "services",
  "calendar",
  "users",
  "system",
];

export default function NotificationsPage() {
  const router = useRouter();
  const { ctx } = useSession();
  const [items, setItems] = useState<AppNotification[]>(() => mockNotifications[ctx.organization.id] ?? []);
  const [filter, setFilter] = useState<NotificationCategory | "all">("all");

  const filtered = filter === "all" ? items : items.filter((n) => n.category === filter);

  const grouped = useMemo(() => {
    const groups = new Map<string, AppNotification[]>();
    for (const n of filtered) {
      const label = dayLabel(n.createdAt);
      groups.set(label, [...(groups.get(label) ?? []), n]);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  function markAllRead() {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
  }

  function openNotification(n: AppNotification) {
    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i)));
    if (n.targetHref) router.push(n.targetHref);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-tight">Notifications</h1>
          <p className="mt-1 text-[13.5px] text-text-soft">Tout ce qui nécessite votre attention, regroupé par jour.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/notifications/preferences"
            className="flex h-10 items-center gap-1.5 rounded-xl border border-border-strong px-3.5 text-[12.5px] font-bold text-text-soft hover:border-brand-blue-pale"
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            Préférences
          </Link>
          <Button variant="secondary" onClick={markAllRead}>
            Tout marquer comme lu
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors duration-sv",
              filter === cat ? "border-brand-blue bg-info-bg text-info-fg" : "border-border text-text-soft hover:border-border-strong",
            )}
          >
            {cat === "all" ? "Tout" : NOTIFICATION_CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <Card className="p-9 text-center text-[13.5px] text-text-soft">Aucune notification pour cette catégorie.</Card>
      ) : (
        grouped.map(([label, notifs]) => (
          <div key={label} className="flex flex-col gap-2.5">
            <div className="text-[11px] font-extrabold uppercase tracking-[.09em] text-text-faint">{label}</div>
            <Card className="divide-y divide-divider">
              {notifs.map((n) => {
                const unread = !n.readAt;
                return (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-sv hover:bg-row-hover",
                      unread && "bg-info-bg/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 flex-none rounded-full",
                        unread ? "bg-brand-blue-electric" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn("text-[13.5px]", unread ? "font-extrabold" : "font-bold")}>{n.title}</span>
                        {n.isPinned && <Badge tone="warning">IMPORTANT</Badge>}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-soft">{n.body}</span>
                    </span>
                    <span className="flex-none text-[11px] font-semibold text-text-faint">
                      {new Date(n.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                );
              })}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
