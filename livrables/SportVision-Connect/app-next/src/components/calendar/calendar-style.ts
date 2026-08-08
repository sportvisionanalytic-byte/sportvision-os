import type { CalendarEventKind } from "@/lib/types/calendar";
import type { BadgeTone } from "@/components/ui/Badge";

// Correspondance nature d'événement → teinte de badge — voir CHARTE.md § Badges de statut
// (couleur + libellé toujours ensemble). Propre au module Calendrier.
export const KIND_TONE: Record<CalendarEventKind, BadgeTone> = {
  match: "info",
  training: "cyan",
  service: "accent",
  shoot: "accent",
  meeting: "neutral",
  publication: "info",
  contract_deadline: "warning",
  invoice_deadline: "danger",
  event: "accent",
  camp: "cyan",
};

export const KIND_DOT: Record<CalendarEventKind, string> = {
  match: "bg-info-fg",
  training: "bg-cyan-fg",
  service: "bg-accent-fg",
  shoot: "bg-accent-fg",
  meeting: "bg-neutral-fg",
  publication: "bg-info-fg",
  contract_deadline: "bg-warning-fg",
  invoice_deadline: "bg-danger-fg",
  event: "bg-accent-fg",
  camp: "bg-cyan-fg",
};
