import type { SupabaseClient } from "@supabase/supabase-js";

// notification_quiet_hours (migration-clubplus-v29-quiet-hours.sql) — une ligne par utilisateur
// (auth.uid()), RLS "nqh_owner_all" (propriétaire, lecture/écriture directe, pas de RPC
// nécessaire). Contrairement aux préférences par catégorie (notification_preferences, v28) dont
// la taxonomie réelle (SECURITY/LEGAL/BILLING/OPERATIONS/SUPPORT/PRODUCT/MARKETING) ne correspond
// pas à celle du design (content/services/contracts/payments/requests/users/calendar/system) —
// pas de mapping honnête possible, laissé non branché — les heures calmes correspondent 1:1
// (not_before/not_after/sunday_urgent_only) et sont donc branchées ici.

export interface QuietHours {
  notBefore: string;
  notAfter: string;
  sundayUrgentOnly: boolean;
}

interface QuietHoursRow {
  not_before: string;
  not_after: string;
  sunday_urgent_only: boolean;
}

export async function fetchQuietHours(supabase: SupabaseClient, userId: string): Promise<QuietHours | null> {
  const { data } = await supabase
    .from("notification_quiet_hours")
    .select("not_before, not_after, sunday_urgent_only")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as QuietHoursRow;
  return {
    notBefore: row.not_before.slice(0, 5),
    notAfter: row.not_after.slice(0, 5),
    sundayUrgentOnly: row.sunday_urgent_only,
  };
}

export async function saveQuietHours(supabase: SupabaseClient, userId: string, input: QuietHours): Promise<void> {
  const { error } = await supabase.from("notification_quiet_hours").upsert({
    user_id: userId,
    not_before: input.notBefore,
    not_after: input.notAfter,
    sunday_urgent_only: input.sundayUrgentOnly,
  });
  if (error) throw error;
}
