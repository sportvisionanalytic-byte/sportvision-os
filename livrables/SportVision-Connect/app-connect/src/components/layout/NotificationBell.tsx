"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORY_META,
  fetchNotifications,
  fetchUnreadCount,
  formatRelativeTime,
  markAllNotificationsRead,
  markNotificationRead,
  type MemberNotification,
} from "@/lib/notifications";

// Cloche de notifications — voir design-connect-personnel-12-08/README.md § Shell et navigation
// ("notifications avec pastille") + § Notifications ("Compteur non lu, tout marquer comme lu,
// marquer lu à l'ouverture selon comportement choisi, [...] Chaque notification doit rediriger
// vers la bonne ressource"). Comportement choisi : l'ouverture du panneau NE marque PAS tout
// comme lu automatiquement (un joueur qui ouvre la cloche par curiosité ne doit pas perdre le
// signal "j'ai quelque chose à regarder" avant de l'avoir réellement lu) — marquage individuel au
// clic (qui navigue vers la ressource) + bouton explicite "Tout marquer comme lu".
//
// Utilisé par AppShell.tsx ET ParticularShell.tsx (composant transverse, README : "topbar (les
// deux espaces)") — aucune prop d'espace nécessaire : `member_notifications` est déjà scopée par
// RLS à `user_id = auth.uid()`, et `target_href` est résolu côté serveur au moment de l'insertion
// (migration-connect-v52 §1, connect_notify_by_client_id) — le composant se contente de naviguer
// vers l'URL déjà correcte, quel que soit l'espace.
//
// Temps réel : `member_notifications` est déjà dans la publication supabase_realtime (migration-
// connect-v42, exécutée) — abonnement direct aux INSERT de l'utilisateur courant, pas de polling.
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MemberNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      fetchUnreadCount(supabase)
        .then((c) => !cancelled && setUnreadCount(c))
        .catch(() => {});

      const ch = supabase
        .channel(`member-notifications-${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "member_notifications", filter: `user_id=eq.${user.id}` },
          () => {
            if (cancelled) return;
            setUnreadCount((c) => c + 1);
          },
        )
        .subscribe();

      // Le composant a pu démonter pendant l'attente de getUser() ci-dessus (montage/démontage
      // très rapide) — évite une fuite de canal jamais nettoyé par le cleanup ci-dessous, déjà
      // passé au moment où ce code s'exécute.
      if (cancelled) {
        supabase.removeChannel(ch);
        return;
      }
      channel = ch;
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const load = useCallback(() => {
    const supabase = createClient();
    setLoading(true);
    setError(null);
    fetchNotifications(supabase)
      .then((data) => setItems(data))
      .catch(() => setError("Impossible de charger vos notifications pour le moment."))
      .finally(() => setLoading(false));
  }, []);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  async function handleItemClick(notif: MemberNotification) {
    if (!notif.readAt) {
      const supabase = createClient();
      setItems((prev) => prev?.map((n) => (n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n)) ?? prev);
      setUnreadCount((c) => Math.max(0, c - 1));
      markNotificationRead(supabase, notif.id).catch(() => {});
    }
    setOpen(false);
    if (notif.targetHref) router.push(notif.targetHref);
  }

  async function handleMarkAllRead() {
    const supabase = createClient();
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);
    setUnreadCount(0);
    markAllNotificationsRead(supabase).catch(() => {});
  }

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} non lues)` : "Notifications"}
        className="relative flex h-10 w-10 items-center justify-center rounded-sv text-text-tertiary hover:bg-white/[.06] hover:text-text"
      >
        <span className="material-symbols-rounded !text-[21px]" aria-hidden="true">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-sv-gradient px-1 font-sora text-[9px] font-bold leading-none text-white">
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-t-sv-card border-t border-border bg-bg-elevated pb-[max(10px,env(safe-area-inset-bottom))] animate-sv-sheet lg:absolute lg:inset-auto lg:right-0 lg:top-[calc(100%+8px)] lg:max-h-[480px] lg:w-[380px] lg:rounded-sv-card lg:border lg:pb-0 lg:animate-sv-in"
          >
            <div className="mx-auto mb-1 mt-2 h-1 w-10 flex-none rounded-full bg-white/15 lg:hidden" />
            <div className="flex flex-none items-center justify-between border-b border-border px-4 py-3.5">
              <span className="font-sora text-[15px] font-semibold">Notifications</span>
              {items && items.some((n) => !n.readAt) && (
                <button type="button" onClick={handleMarkAllRead} className="text-[13px] font-medium text-[#8CA9FF] hover:text-[#B6C7FF] lg:text-[12px]">
                  Tout marquer comme lu
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && !items && (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[58px] animate-pulse rounded-sv bg-white/[.05]" style={{ animationDelay: `${i * 100}ms` }} />
                  ))}
                </div>
              )}

              {error && <div className="p-4 text-[14px] text-text-tertiary lg:text-[13px]">{error}</div>}

              {items && items.length === 0 && !loading && (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <span className="material-symbols-rounded !text-[26px] text-text-faint" aria-hidden="true">notifications_off</span>
                  <p className="text-[14px] text-text-tertiary lg:text-[13px]">Aucune notification pour le moment.</p>
                </div>
              )}

              {items?.map((notif) => {
                const meta = CATEGORY_META[notif.category] ?? CATEGORY_META.system;
                return (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => handleItemClick(notif)}
                    className={`flex w-full items-start gap-3 border-b border-border/60 px-4 py-3.5 text-left last:border-b-0 hover:bg-white/[.04] ${
                      !notif.readAt ? "bg-white/[.03]" : ""
                    }`}
                  >
                    <span
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
                      style={{ background: meta.bg, color: meta.fg }}
                    >
                      <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">{meta.icon}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-text lg:text-[13.5px]">{notif.title}</span>
                        {!notif.readAt && <span className="h-[7px] w-[7px] flex-none rounded-full bg-[#8CA9FF]" />}
                      </span>
                      {notif.body && <span className="line-clamp-2 text-[13.5px] leading-snug text-text-tertiary lg:text-[12.5px]">{notif.body}</span>}
                      <span className="text-[11px] text-text-faint">{formatRelativeTime(notif.createdAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
