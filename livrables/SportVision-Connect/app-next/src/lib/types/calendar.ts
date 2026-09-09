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
  // Portés par le calendrier unifié (club_calendrier, vague B) pour que la carte d'un match dise
  // ce qu'un CM a besoin de lire d'un coup d'œil, sans une requête de plus par carte.
  opponent?: string;
  isHome?: boolean;
  competition?: string;
  score?: string;
  /** Écusson du club adverse, servi depuis notre bucket (jamais depuis le site source : un visuel
   *  publié doit continuer de s'afficher dans six mois). Absent tant que le match n'est pas
   *  rattaché à un club de l'annuaire — l'affichage doit donc toujours prévoir le cas. */
  opponentLogoUrl?: string;
  /** Statut de la présence SportVision existante ('prevu', 'mission_creee'), sinon absent.
   *  En lecture seule pour l'instant : le clic « SportVision sera présent » arrive en vague C. */
  coverage?: string;
}
