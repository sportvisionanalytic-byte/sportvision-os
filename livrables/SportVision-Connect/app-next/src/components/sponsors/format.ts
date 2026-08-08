import type { BadgeTone } from "@/components/ui/Badge";
import type { SponsorLevel, SponsorStatus } from "@/lib/types/sponsors";

// Libellés et tons partagés entre /sponsors et /sponsors/:id — voir CHARTE.md § Badges de
// statut : toujours couleur + libellé texte, jamais la couleur seule.

export const SPONSOR_LEVEL_LABEL: Record<SponsorLevel, string> = {
  platine: "Platine",
  or: "Or",
  argent: "Argent",
  bronze: "Bronze",
};

export const SPONSOR_LEVEL_TONE: Record<SponsorLevel, BadgeTone> = {
  platine: "accent",
  or: "warning",
  argent: "neutral",
  bronze: "cyan",
};

export const SPONSOR_STATUS_LABEL: Record<SponsorStatus, string> = {
  active: "Actif",
  to_renew: "À renouveler",
  expired: "Expiré",
};

export const SPONSOR_STATUS_TONE: Record<SponsorStatus, BadgeTone> = {
  active: "success",
  to_renew: "warning",
  expired: "danger",
};

export function formatEuro(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} €`;
}
