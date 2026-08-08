"use client";

import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/billing/LockedModule";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, formatEuroTTC, totalLabel } from "@/components/billing/format";
import { daysLate, mockInvoices } from "@/lib/mock/billing";

// Fiche facture — ACTIONS.md § 19. Lignes détaillées, totaux HT/TVA/acompte, libellé du total
// adaptatif, actions conditionnées au statut.
export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();

  if (!canAccess(ctx, "billing")) return <LockedModule ctx={ctx} />;

  const invoice = mockInvoices.find((i) => i.id === params.id && i.organizationId === ctx.organization.id);

  if (!invoice) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Facture introuvable.</div>
        <Link href="/billing">
          <Button variant="secondary">Retour aux factures</Button>
        </Link>
      </Card>
    );
  }

  const payable = invoice.status === "a_payer" || invoice.status === "en_retard";
  const late = invoice.status === "en_retard" ? daysLate(invoice.dueDate) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/billing" className="text-[12px] font-bold text-text-soft hover:text-brand-blue-electric">
            ← Factures
          </Link>
          <h1 className="mt-1.5 font-mono text-[26px] font-extrabold leading-tight tracking-tight">{invoice.number}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={INVOICE_STATUS_TONE[invoice.status]}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
            {invoice.status === "en_retard" && (
              <span className="text-[12px] font-bold text-danger-fg">en retard depuis {late} j</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Télécharger le PDF
          </Button>
          {payable && <Button variant="primary">Payer {formatEuroTTC(invoice.totalInclVat)}</Button>}
          {invoice.status === "payee" && (
            <Button variant="primary">
              <Receipt className="h-3.5 w-3.5" aria-hidden />
              Télécharger le reçu
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Info label="Objet" value={invoice.subject} />
          <Info label="Date d'émission" value={invoice.issueDate} />
          <Info label="Date d'échéance" value={invoice.dueDate} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_80px_120px_120px] gap-3 border-b border-divider bg-surface-alt px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:grid">
          <span>Ligne</span>
          <span className="text-right">Qté</span>
          <span className="text-right">Prix unitaire HT</span>
          <span className="text-right">Total HT</span>
        </div>
        {invoice.lines.map((line, i) => (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 px-5 py-3.5 text-[13px] last:border-0 sm:grid-cols-[1fr_80px_120px_120px] sm:items-center sm:gap-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-divider"
          >
            <span className="font-bold text-text">{line.label}</span>
            <span className="text-right text-text-soft">{line.quantity ?? "—"}</span>
            <span className="text-right text-text-soft">
              {typeof line.unitPriceExclVat === "number" ? `${line.unitPriceExclVat.toLocaleString("fr-FR")} €` : "—"}
            </span>
            <span className="text-right font-bold text-text">{line.totalExclVat.toLocaleString("fr-FR")} €</span>
          </div>
        ))}

        <div className="flex flex-col gap-1.5 border-t border-divider bg-surface-alt px-5 py-4">
          <TotalRow label="Sous-total HT" value={`${invoice.subtotalExclVat.toLocaleString("fr-FR")} €`} />
          <TotalRow label={`TVA (${invoice.vatRate} %)`} value={`${invoice.vatAmount.toLocaleString("fr-FR")} €`} />
          {invoice.depositApplied > 0 && (
            <TotalRow label="Acompte déduit" value={`− ${invoice.depositApplied.toLocaleString("fr-FR")} €`} />
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-divider pt-2">
            <span className="text-[13.5px] font-extrabold text-text">{totalLabel(invoice.status)}</span>
            <span className="text-[18px] font-extrabold tracking-tight text-text">{formatEuroTTC(invoice.totalInclVat)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-bold text-text">{value}</dd>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[12.5px]">
      <span className="text-text-soft">{label}</span>
      <span className="font-bold text-text">{value}</span>
    </div>
  );
}
