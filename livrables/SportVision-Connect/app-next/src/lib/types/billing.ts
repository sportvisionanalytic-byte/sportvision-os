// Entités des modules Contrats et Factures — voir DATA_MODEL.md § Contract et Invoice.
// Fichier séparé de src/lib/types.ts par convention de non-conflit (voir README.md §
// Conventions pour construire un nouveau module).

export type ContractStatus =
  | "brouillon"
  | "envoye"
  | "consulte"
  | "signe"
  | "actif"
  | "a_renouveler"
  | "resilie"
  | "expire";

export type ContractKind = "abonnement" | "prestation_unique" | "avenant";

export interface ContractSignatory {
  name: string;
  role: string;
  signedAt?: string;
}

/** Point « à retenir » — 5 par fiche contrat, ACTIONS.md § 18. */
export interface ContractKeyTerm {
  id: string;
  label: string;
}

/** L'une des 8 conditions affichées en fiche contrat — ACTIONS.md § 18. */
export interface ContractCondition {
  label: string;
  value: string;
}

export interface Contract {
  id: string;
  organizationId: string;
  /** Dérivé de l'offre — ex. « Club+ Performance », « Full Communication ». */
  name: string;
  kind: ContractKind;
  planCode?: string;
  startsAt: string;
  endsAt: string;
  status: ContractStatus;
  /** null = pas de mensualité fixe (offre sur devis). */
  monthlyAmount: number | null;
  commitmentMonths: number;
  noticeMonths: number;
  signatories: ContractSignatory[];
  signatureProvider: "yousign";
  /** Le lien de signature expire à 8 jours. */
  signatureUrl?: string;
  signatureRequestedAt?: string;
  viewedAt?: string;
  signedAt?: string;
  documentId?: string;
  annexIds: string[];
  amendmentIds: string[];
  keyTerms: ContractKeyTerm[];
  conditions: ContractCondition[];
}

export type ContractScheduleKind = "installment" | "notice_window" | "contract_end";
export type ContractScheduleStatus = "a_venir" | "du" | "regle" | "depasse";

export interface ContractSchedule {
  id: string;
  contractId: string;
  dueDate: string;
  label: string;
  amount?: number;
  kind: ContractScheduleKind;
  status: ContractScheduleStatus;
}

export type InvoiceStatus =
  | "brouillon"
  | "a_payer"
  | "payee"
  | "en_retard"
  | "suspension"
  | "regularisee"
  | "annulee"
  | "remboursee";

export interface InvoiceLine {
  label: string;
  quantity?: number;
  unitPriceExclVat?: number;
  totalExclVat: number;
}

export interface Invoice {
  id: string;
  /** Format SV-AAAA-NNNN. */
  number: string;
  organizationId: string;
  contractId?: string;
  serviceId?: string;
  issueDate: string;
  dueDate: string;
  subject: string;
  lines: InvoiceLine[];
  subtotalExclVat: number;
  /** 20 %. */
  vatRate: number;
  vatAmount: number;
  depositApplied: number;
  totalInclVat: number;
  status: InvoiceStatus;
  paymentMethod?: string;
  paidAt?: string;
  pdfUrl?: string;
  receiptUrl?: string;
  remindersSentAt: string[];
}

/** Les 4 derniers chiffres seulement — jamais de numéro de carte complet, voir DATA_MODEL.md. */
export interface PaymentMethod {
  brand: "visa" | "mastercard";
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Étape de relance — ACTIONS.md / DATA_MODEL.md § Règle de suspension : 3, 8, 15 jours. */
export type OverdueStage = "none" | "reminder_1" | "reminder_2" | "reminder_3" | "suspended";

export function getOverdueStage(daysLate: number): OverdueStage {
  if (daysLate <= 0) return "none";
  if (daysLate < 3) return "none";
  if (daysLate < 8) return "reminder_1";
  if (daysLate < 15) return "reminder_2";
  if (daysLate === 15) return "reminder_3";
  return "suspended";
}
