import type { SupabaseClient } from "@supabase/supabase-js";

// member_notifications (migration-connect-v16-member-notifications.sql) — table neuve, générique
// à tout type de compte Connect, keyed sur auth.uid() direct (même patron que
// notification_preferences/notification_quiet_hours). Écriture réservée au staff + triggers
// security definer (facture en_retard/payee, contenu a_valider_client) — jamais un INSERT direct
// depuis le client.

export type NotificationCategory = "content" | "requests" | "payments" | "contracts" | "services" | "calendar" | "users" | "system";

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

export async function fetchNotifications(supabase: SupabaseClient): Promise<MemberNotification[]> {
  const { data, error } = await supabase
    .from("member_notifications")
    .select("id, category, title, body, target_href, is_pinned, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as NotificationRow[]).map(toNotification);
}

export async function markNotificationRead(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("member_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from("member_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
}
