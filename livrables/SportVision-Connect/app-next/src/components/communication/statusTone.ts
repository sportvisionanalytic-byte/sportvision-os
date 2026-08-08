import type { BadgeTone } from "@/components/ui/Badge";
import type { PresenceStatus, PublicationDisplayStatus, PublicationStatus } from "@/lib/types/communication";

// Correspondance statut → couleur de puce — CHARTE.md § Badges de statut. Toujours
// couleur + libellé texte, jamais la couleur seule (le composant Badge porte déjà le libellé).

export function publicationStatusTone(status: PublicationStatus): BadgeTone {
  switch (status) {
    case "idea":
      return "neutral";
    case "to_produce":
      return "accent";
    case "in_creation":
      return "info";
    case "to_validate":
      return "accent";
    case "corrections":
      return "warning";
    case "validated":
      return "success";
    case "scheduled":
      return "info";
    case "published":
      return "success";
    case "publish_error":
      return "danger";
    case "cancelled":
      return "danger";
  }
}

export function displayStatusTone(status: PublicationDisplayStatus): BadgeTone {
  switch (status) {
    case "Publiée":
      return "success";
    case "À valider":
      return "accent";
    case "En préparation":
      return "info";
    case "Erreur de publication":
      return "danger";
    case "Annulée":
      return "danger";
  }
}

export function presenceStatusTone(status: PresenceStatus): BadgeTone {
  switch (status) {
    case "scheduled":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

const DOT_CLASS: Record<BadgeTone, string> = {
  success: "bg-success-fg",
  warning: "bg-warning-fg",
  danger: "bg-danger-fg",
  info: "bg-info-fg",
  accent: "bg-accent-fg",
  cyan: "bg-cyan-fg",
  neutral: "bg-neutral-fg",
};

/** Pastille pleine couleur pour les vignettes compactes (calendrier) — même palette que Badge. */
export function toneDotClass(tone: BadgeTone): string {
  return DOT_CLASS[tone];
}

export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = {
  scheduled: "À venir",
  completed: "Réalisée",
  cancelled: "Annulée",
};
