import type { BadgeTone } from "@/components/ui/Badge";
import type { InvoiceStatus, PaymentMethod } from "@/lib/types/billing";

// Libellés et tons partagés — voir CHARTE.md § Badges de statut et README.md § Chaînes de
// statuts « Facture » : Brouillon → À payer → Payée · exception : À payer → En retard →
// Suspension → Régularisée · Annulée · Remboursée.

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  brouillon: "Brouillon",
  emise: "Émise",
  a_payer: "À payer",
  payee: "Payée",
  en_retard: "En retard",
  suspension: "Suspendue",
  regularisee: "Régularisée",
  annulee: "Annulée",
  remboursee: "Remboursée",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  brouillon: "neutral",
  emise: "warning",
  a_payer: "warning",
  payee: "success",
  en_retard: "danger",
  suspension: "danger",
  regularisee: "info",
  annulee: "neutral",
  remboursee: "info",
};

export function formatEuroTTC(amount: number): string {
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC`;
}

const BRAND_LABEL: Record<PaymentMethod["brand"], string> = {
  visa: "Visa",
  mastercard: "Mastercard",
};

export function formatPaymentMethod(method: PaymentMethod): string {
  return `${BRAND_LABEL[method.brand]} •••• ${method.last4} — exp. ${String(method.expMonth).padStart(2, "0")}/${method.expYear}`;
}

/** Le libellé du total s'adapte au statut — ACTIONS.md § 19 « Fiche facture ». */
export function totalLabel(status: InvoiceStatus): string {
  if (status === "payee" || status === "regularisee") return "Montant réglé";
  if (status === "brouillon") return "Montant estimé";
  return "Net à payer";
}
