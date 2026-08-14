import type { SupabaseClient } from "@supabase/supabase-js";

// Notifications topbar — voir design-connect-personnel-12-08/README.md § Shell et navigation +
// § Notifications, MASTER-CONNECT-V1.md §29. Table `member_notifications` (migration-connect-
// v16, réutilisée telle quelle — voir migration-connect-v53-topbar-notifications-recherche.sql
// §0 pour la justification complète), RLS scopée `user_id = auth.uid()` : toute lecture passe
// par le client Supabase du navigateur (pas de RPC nécessaire pour la lecture, la RLS suffit et
// c'est le même patron que app-next/src/lib/data/shared/notifications.ts avant la scission
// Connect/Club+).
//
// Catégorie 'messages' ajoutée au CHECK constraint par la migration v52 — les 8 autres valeurs
// existaient déjà (v16).
export type NotificationCategory =
  | "content"
  | "requests"
  | "payments"
  | "contracts"
  | "services"
  | "calendar"
  | "users"
  | "system"
  | "messages";

export interface MemberNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  targetHref: string | null;
  isPinned: boolean;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  category: string;
  title: string;
  body: string | null;
  target_href: string | null;
  is_pinned: boolean;
  read_at: string | null;
  created_at: string;
}

function toNotification(row: NotificationRow): MemberNotification {
  return {
    id: row.id,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    targetHref: row.target_href,
    isPinned: row.is_pinned,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// Icône + couleur par catégorie — réutilise exclusivement les tokens déjà définis
// (tailwind.config.ts § une couleur par pilier fonctionnel), aucune couleur inventée.
export const CATEGORY_META: Record<NotificationCategory, { icon: string; fg: string; bg: string }> = {
  content: { icon: "photo_library", fg: "#C084FC", bg: "rgba(168,85,247,.16)" }, // contenus
  requests: { icon: "inbox", fg: "#22D3EE", bg: "rgba(34,211,238,.14)" }, // affiliations
  payments: { icon: "payments", fg: "#F472B6", bg: "rgba(244,114,182,.14)" }, // cotisations
  contracts: { icon: "description", fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" }, // prestations
  services: { icon: "camera_alt", fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" }, // prestations
  calendar: { icon: "event", fg: "#FBBF24", bg: "rgba(251,191,36,.14)" }, // attente
  users: { icon: "group", fg: "#22D3EE", bg: "rgba(34,211,238,.14)" }, // affiliations
  system: { icon: "info", fg: "#9A9AB8", bg: "rgba(255,255,255,.07)" }, // neutre
  messages: { icon: "forum", fg: "#8CA9FF", bg: "rgba(79,125,255,.16)" }, // prestations
};

export async function fetchNotifications(supabase: SupabaseClient, limit = 30): Promise<MemberNotification[]> {
  const { data, error } = await supabase
    .from("member_notifications")
    .select("id, category, title, body, target_href, is_pinned, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as NotificationRow[]).map(toNotification);
}

export async function fetchUnreadCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("member_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("member_notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  if (error) throw error;
}

export async function markAllNotificationsRead(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from("member_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) throw error;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `Il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
