import type { BadgeTone } from "@/components/ui/Badge";
import type { ContractScheduleStatus, ContractStatus } from "@/lib/types/billing";

// Libellés et tons partagés — voir CHARTE.md § Badges de statut et README.md § Chaînes de
// statuts « Contrat » : Brouillon → Envoyé → Consulté → Signé → Actif → À renouveler → Résilié ·
// Expiré.

// contrats.type_contrat (migration-contrats-v2-types-banque.sql, CHECK) : ponctuel,
// full_communication, club_plus, coach_academie, evenement, joueur, sponsoring, pilote, autre.
// Sert de nom de contrat affiché côté client (voir data/projet/billing.ts::fetchClientContracts) —
// sans ce libellé, le client voyait la valeur brute de la colonne ("club_plus", "full_communication"…).
export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  ponctuel: "Prestation ponctuelle",
  full_communication: "Full Communication",
  club_plus: "Club+",
  coach_academie: "Coach / Académie",
  evenement: "Événement",
  joueur: "Joueur",
  sponsoring: "Sponsoring",
  pilote: "Pilote",
  autre: "Autre",
};

// Version des CGV en vigueur — à mettre à jour manuellement à chaque nouvelle version publiée
// sur la vitrine (cf. cgv.html, balise <p class="legal-updated">, "Version finale ..."). Même
// valeur que le module vanilla équivalent (SportVision-Connect/app/modules/projet-dashboard-
// devis-contrats-factures.js) — les deux doivent rester synchronisés à chaque changement de CGV.
export const CGV_VERSION = "V1.0 (9 août 2026)";
export const CGV_URL = "https://sportvision-an.fr/cgv.html";

// Même règle que reserver.html / le module vanilla : la demande expresse d'exécution anticipée
// (CGV Art. 35.1) n'a de sens que si la prestation liée au devis a lieu avant l'expiration du
// délai légal de rétractation de 14 jours. `datePrestation` vient de client_devis (étendue par
// migration-devis-cgv-execution-anticipee-11-08.sql, join sur prestations) ; absente pour un
// devis sans prestation liée (Club+/Full Communication) → jamais affichée dans ce cas, choix
// conservateur plutôt qu'une omission.
export function needsExecutionAnticipee(datePrestation: string | null): boolean {
  if (!datePrestation) return false;
  const prestationDate = new Date(`${datePrestation}T00:00:00`);
  if (Number.isNaN(prestationDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const joursAvant = Math.round((prestationDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return joursAvant >= 0 && joursAvant < 14;
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  consulte: "Consulté",
  signe: "Signé",
  actif: "Actif",
  a_renouveler: "À renouveler",
  suspendu: "Suspendu",
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
  suspendu: "danger",
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

/** Le lien de signature Youtrust expire à 8 jours — DATA_MODEL.md § Contract. */
export function signatureExpiresAt(requestedAt: string): string {
  const d = new Date(requestedAt);
  d.setDate(d.getDate() + 8);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}
