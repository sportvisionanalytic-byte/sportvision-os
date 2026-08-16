"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Settings2 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { hasClubFinancialAccess, isClubCommunicationOrEducateur } from "@/lib/permissions";
import type { ActiveContext } from "@/lib/types";
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/supabase/realtime";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type MemberNotification,
} from "@/lib/data/shared/notifications";

// /notifications — voir ACTIONS.md § 23. Regroupement par jour, filtres par catégorie, non lues
// sur fond teinté avec point bleu, badge « IMPORTANT » sur les épinglées, Tout marquer comme lu.
// Branché le 09/08/2026 sur member_notifications (migration-connect-v16-member-notifications.sql,
// EN ATTENTE D'EXÉCUTION) — jusqu'à son exécution, la liste reste honnêtement vide (aucune ligne
// en base), jamais un contenu fictif.
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

const ALL_CATEGORY_FILTERS: (NotificationCategory | "all")[] = [
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

/**
 * Catégories adaptées au rôle — Bible §21 : "ne pas montrer un filtre Finance au Coach".
 * Réutilise les deux garde-fous déjà en place pour ces mêmes notions ailleurs dans l'app (jamais
 * un nouveau système de résolution de rôle) : hasClubFinancialAccess (billing/contracts/documents
 * page.tsx — bureau du club uniquement) pour "payments"/"contracts", et
 * isClubCommunicationOrEducateur (users/page.tsx — jamais Utilisateurs pour Communication/Coach)
 * pour "users". Un filtre masqué ici ne remplace aucune vérification backend : la RLS de
 * member_notifications reste la seule barrière réelle, ce n'est qu'un nettoyage d'UI cohérent
 * avec ce que l'utilisateur peut de toute façon ouvrir.
 */
function visibleCategoryFilters(ctx: ActiveContext): (NotificationCategory | "all")[] {
  return ALL_CATEGORY_FILTERS.filter((cat) => {
    if ((cat === "payments" || cat === "contracts") && !hasClubFinancialAccess(ctx)) return false;
    if (cat === "users" && isClubCommunicationOrEducateur(ctx)) return false;
    return true;
  });
}

export default function NotificationsPage() {
  const router = useRouter();
  const { ctx } = useSession();
  const [items, setItems] = useState<MemberNotification[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<NotificationCategory | "all">("all");
  const categoryFilters = useMemo(() => visibleCategoryFilters(ctx), [ctx]);

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      setItems(await fetchNotifications(supabase));
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync temps réel (migration-connect-v42-enable-realtime-sync.sql) : `member_notifications`
  // est keyed directement sur auth.uid() (migration-connect-v16-member-notifications.sql), pas
  // sur l'organisation active — même colonne que la policy mn_owner_select. Rejoue reload()
  // ci-dessus, ne duplique aucune logique de requête. Dégrade silencieusement tant que la
  // migration v42 n'a pas été exécutée (voir realtime.ts).
  useEffect(() => {
    const supabase = createClient();
    const channel = subscribeTable(
      supabase,
      `member-notifications-${ctx.user.id}`,
      "member_notifications",
      `user_id=eq.${ctx.user.id}`,
      reload,
    );
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.user.id]);

  const filtered = (items ?? []).filter((n) => filter === "all" || n.category === filter);

  const grouped = useMemo(() => {
    const groups = new Map<string, MemberNotification[]>();
    for (const n of filtered) {
      const label = dayLabel(n.createdAt);
      groups.set(label, [...(groups.get(label) ?? []), n]);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  function markAllRead() {
    const supabase = createClient();
    setItems((prev) => (prev ? prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })) : prev));
    markAllNotificationsRead(supabase).catch(() => reload());
  }

  function openNotification(n: MemberNotification) {
    if (!n.readAt) {
      const supabase = createClient();
      setItems((prev) => (prev ? prev.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)) : prev));
      markNotificationRead(supabase, n.id).catch(() => reload());
    }
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
        {categoryFilters.map((cat) => (
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

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les notifications.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {items === null ? (
        <Card className="p-9 text-center text-[13.5px] text-text-soft">Chargement…</Card>
      ) : grouped.length === 0 ? (
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
