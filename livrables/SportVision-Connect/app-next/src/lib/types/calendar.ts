// Types du calendrier central — voir DATA_MODEL.md § CalendarEvent.
// « Le calendrier central est une vue agrégée : prestations, publications et échéances y
// apparaissent sans duplication. » Fichier dédié, voir README.md § Conventions pour construire
// un nouveau module.

export type CalendarEventKind =
  | "match"
  | "training"
  | "service"
  | "shoot"
  | "meeting"
  | "publication"
  | "contract_deadline"
  | "invoice_deadline"
  | "event"
  | "camp";

export const CALENDAR_EVENT_KIND_LABELS: Record<CalendarEventKind, string> = {
  match: "Match",
  training: "Entraînement",
  service: "Prestation",
  shoot: "Tournage",
  meeting: "Réunion",
  publication: "Publication",
  contract_deadline: "Échéance de contrat",
  invoice_deadline: "Échéance de facture",
  event: "Événement",
  camp: "Stage",
};

export interface CalendarEvent {
  id: string;
  organizationId: string;
  kind: CalendarEventKind;
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  location?: string;
  teamName?: string;
  teamId?: string;
  sourceHref?: string;
  status?: string;
}
