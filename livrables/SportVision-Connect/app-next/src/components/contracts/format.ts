import type { BadgeTone } from "@/components/ui/Badge";
import type { ContractScheduleStatus, ContractStatus } from "@/lib/types/billing";

// Libellés et tons partagés — voir CHARTE.md § Badges de statut et README.md § Chaînes de
// statuts « Contrat » : Brouillon → Envoyé → Consulté → Signé → Actif → À renouveler → Résilié ·
// Expiré.

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  consulte: "Consulté",
  signe: "Signé",
  actif: "Actif",
  a_renouveler: "À renouveler",
  resilie: "Résilié",
  expire: "Expiré",
};

export const CONTRACT_STATUS_TONE: Record<ContractStatus, BadgeTone> = {
  brouillon: "neutral",
  envoye: "info",
  consulte: "info",
  signe: "success",
  actif: "success",
  a_renouveler: "warning",
  resilie: "danger",
  expire: "neutral",
};

export const SCHEDULE_STATUS_LABEL: Record<ContractScheduleStatus, string> = {
  a_venir: "À venir",
  du: "Dû",
  regle: "Réglé",
  depasse: "Dépassé",
};

export const SCHEDULE_STATUS_TONE: Record<ContractScheduleStatus, BadgeTone> = {
  a_venir: "info",
  du: "warning",
  regle: "success",
  depasse: "neutral",
};

export function formatMonthlyAmount(amount: number | null): string {
  if (amount === null) return "Sur devis";
  return `${amount.toLocaleString("fr-FR")} € TTC / mois`;
}

/** Le lien de signature Yousign expire à 8 jours — DATA_MODEL.md § Contract. */
export function signatureExpiresAt(requestedAt: string): string {
  const d = new Date(requestedAt);
  d.setDate(d.getDate() + 8);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}
