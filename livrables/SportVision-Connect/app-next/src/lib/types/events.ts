// Types propres aux espaces spécifiques Coach / Académie / Tournoi Full Communication —
// ACTIONS.md § 10, DATA_MODEL.md § Camp, § EventPhase. Ne duplique rien de src/lib/types.ts.

/** Séance du coach — ACTIONS.md § 10 « Coach Full Com — /sessions ». */
export interface CoachSession {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  status: "capture_planned" | "confirmed" | "to_confirm";
}

/** Stage de l'académie — ACTIONS.md § 10 « Académie Full Com — /camps », DATA_MODEL.md § Camp. */
export interface Camp {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  groups: string[];
  capacity: number;
  registered: number;
  status: "upcoming" | "open" | "full" | "running" | "completed";
}

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
