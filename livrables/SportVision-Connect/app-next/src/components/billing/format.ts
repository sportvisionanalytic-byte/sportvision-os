import type { BadgeTone } from "@/components/ui/Badge";
import type { InvoiceStatus, PaymentMethod } from "@/lib/types/billing";

// Libellés et tons partagés — voir CHARTE.md § Badges de statut et README.md § Chaînes de
// statuts « Facture » : Brouillon → À payer → Payée · exception : À payer → En retard →
// Suspension → Régularisée · Annulée · Remboursée. "Partiellement payée" ajoutée le 16/08
// (CLUB-PLUS-PRODUCT-BIBLE.md §19, migration-clubplus-v39.sql) — un solde reste dû, distinct
// d'« Émise » (rien réglé) et de « Payée » (tout réglé).

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  brouillon: "Brouillon",
  emise: "Émise",
  a_payer: "À payer",
  partiellement_payee: "Partiellement payée",
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
  partiellement_payee: "warning",
  payee: "success",
  en_retard: "danger",
  suspension: "danger",
  regularisee: "info",
  annulee: "neutral",
  remboursee: "info",
};

/** Reste à régler (§19 « Détail : ... déjà payé, reste à régler, PDF »). Toujours >= 0 même si
 * paidAmount dépasse totalInclVat par erreur de saisie côté backend. */
export function remainingAmount(totalInclVat: number, paidAmount: number): number {
  return Math.max(0, totalInclVat - paidAmount);
}

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
  if (status === "partiellement_payee") return "Montant total";
  return "Net à payer";
}
