import type { SupabaseClient } from "@supabase/supabase-js";

// `event_checklist_items` (migration-connect-v22-event-checklist-items.sql) — checklist en 3
// phases (avant / jour J / après) pour une organisation `event` (tournoi Full Communication).
// Remplace le mock 3-phases figé (eventPhasesByEventOrg, lib/mock/events.ts, retiré le
// 10/08/2026 — plan Tier C § Phase 4). Lu directement par `organization_id` : une organisation
// `event` n'a pas de facturation/documents Portail au même sens qu'un club, pas besoin de
// résoudre un `client_id` ici (contrairement à sessions/camps qui affichent un état "pas encore
// relié" — la checklist n'a pas besoin de ce pont).
//
// Écriture (cocher/décocher) réservée au staff (policy eci_staff_write, profiles.role in
// ('admin','sec','com')) — voir SportVision-OS-Full.html § modalChecklistEvenement. Ce module
// n'expose donc que la lecture, cohérent avec le reste de l'écosystème Connect (staff pilote,
// l'espace event consulte). Pas de seed automatique : un tableau vide est un état légitime
// ("le staff n'a pas encore généré la checklist"), pas une erreur.

export type EventChecklistPhase = "avant" | "jour_j" | "apres";

export interface EventChecklistItem {
  id: string;
  phase: EventChecklistPhase;
  label: string;
  fait: boolean;
  /** Posé côté serveur (trigger set_event_checklist_fait) au moment où `fait` passe à true —
   * jamais confié au payload client. `null` tant que l'item n'a jamais été coché. */
  faitLe: string | null;
}

interface EventChecklistItemRow {
  id: string;
  phase: string;
  label: string;
  fait: boolean;
  fait_le: string | null;
}

export async function fetchEventChecklist(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<EventChecklistItem[]> {
  const { data, error } = await supabase
    .from("event_checklist_items")
    .select("id, phase, label, fait, fait_le")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as EventChecklistItemRow[]).map((row) => ({
    id: row.id,
    phase: row.phase as EventChecklistPhase,
    label: row.label,
    fait: row.fait,
    faitLe: row.fait_le,
  }));
}
