// Types propres à l'espace spécifique Tournoi Full Communication — ACTIONS.md § 10,
// DATA_MODEL.md § EventPhase. Ne duplique rien de src/lib/types.ts.
//
// CoachSession/Camp (Coach/Académie) retirés le 10/08/2026 (plan Tier C § Phase 1 Séances/
// Stages) : /sessions et /camps lisent désormais calendar_events réel, dont la forme (event_date/
// title/context, voir migration-connect-v3-coach-academie-requests.sql) ne correspond pas à ces
// types mock (heure/lieu/statut, venue/groupes/capacité inventés) — types réels dans
// data/coach/sessions.ts (CoachSessionEvent) et data/academie/camps.ts (AcademieCampEvent).

/** Une des 3 phases de la timeline d'un tournoi — ACTIONS.md § 10, DATA_MODEL.md § EventPhase. */
export type EventPhaseKind = "before" | "during" | "after";

export interface EventPhaseItem {
  label: string;
  description: string;
  done: boolean;
}

export interface EventPhase {
  phase: EventPhaseKind;
  label: string;
  dateLabel: string;
  status: "planned" | "in_progress" | "completed";
  items: EventPhaseItem[];
}

/** Le fil du jour d'un tournoi — ACTIONS.md § 10 « Tournoi Full Com — /live ». */
export interface LiveStat {
  label: string;
  value: string;
}

export interface LiveFeedItem {
  id: string;
  time: string;
  label: string;
  platform: string;
}
