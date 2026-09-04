"use client";

import { CheckCircle2, Receipt, FileText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatEuroTTC } from "@/components/billing/format";
import type { Invoice } from "@/lib/types/billing";
import { Card } from "@/components/ui/Card";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

// Focus finance Trésorier (Bible §10 : "Dashboard | Factures à régler / retard / devis / paiements
// récents. Aucun contenu sportif parasite.") — extrait de ClubPlusDashboard.tsx (03/09/2026,
// chantier "Dashboard par rôle") pour être réutilisé tel quel par FullCommunicationDashboard :
// un trésorier d'un club Full Communication voyait jusqu'ici EXACTEMENT le même écran de
// communication (métriques CM, planning éditorial) qu'un président ou un coach — sans aucune
// donnée financière irrelevante, ni harmonisation avec le comportement déjà correct côté Club+
// classique. Une seule implémentation, jamais deux logiques de synthèse finance divergentes.
export interface FinanceSummary {
  toPayCount: number;
  toPayTotal: number;
  overdueCount: number;
  overdueTotal: number;
  pendingDevisCount: number;
  recentPayments: Invoice[];
}

export function summarizeFinance(invoices: Invoice[], pendingDevisCount: number): FinanceSummary {
  const overdue = invoices.filter((i) => i.status === "en_retard");
  const toPay = invoices.filter((i) => i.status === "emise" || i.status === "partiellement_payee");
  const recentPayments = [...invoices]
    .filter((i) => i.status === "payee")
    .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))
    .slice(0, 3);
  return {
    toPayCount: toPay.length,
    toPayTotal: toPay.reduce((sum, i) => sum + i.totalInclVat, 0),
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((sum, i) => sum + i.totalInclVat, 0),
    pendingDevisCount,
    recentPayments,
  };
}

export function FinanceSummaryCard({
  summary,
  error,
  onRetry,
  onOpenBilling,
}: {
  summary: FinanceSummary | null | undefined;
  error: boolean;
  onRetry: () => void;
  onOpenBilling: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-divider px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-[#F5A623]" />
          <span className="text-[15px] font-extrabold tracking-tight">Finance</span>
        </div>
        <button onClick={onOpenBilling} className="-m-3 p-3 text-[12.5px] font-bold text-brand-blue-electric">
          Tout voir
        </button>
      </div>
      {error ? (
        <ErrorState message="Impossible de charger votre synthèse financière." onRetry={onRetry} />
      ) : summary === undefined ? (
        <div>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : summary === null ? (
        <EmptyState
          icon={Receipt}
          title="Facturation pas encore reliée"
          description="SportVision n'a pas encore relié votre espace à Facturation."
        />
      ) : (
        <FinanceRows summary={summary} onOpenBilling={onOpenBilling} />
      )}
    </Card>
  );
}

function FinanceRows({ summary, onOpenBilling }: { summary: FinanceSummary; onOpenBilling: () => void }) {
  const rows: { key: string; icon: LucideIcon; title: string; meta: string; danger?: boolean }[] = [];
  if (summary.overdueCount > 0) {
    rows.push({
      key: "overdue",
      icon: Receipt,
      title: `${summary.overdueCount} facture${summary.overdueCount > 1 ? "s" : ""} en retard`,
      meta: formatEuroTTC(summary.overdueTotal),
      danger: true,
    });
  }
  if (summary.toPayCount > 0) {
    rows.push({
      key: "toPay",
      icon: Receipt,
      title: `${summary.toPayCount} facture${summary.toPayCount > 1 ? "s" : ""} à régler`,
      meta: formatEuroTTC(summary.toPayTotal),
    });
  }
  if (summary.pendingDevisCount > 0) {
    rows.push({
      key: "devis",
      icon: FileText,
      title: `${summary.pendingDevisCount} devis en attente de votre décision`,
      meta: "Voir avant d'accepter",
    });
  }
  for (const payment of summary.recentPayments) {
    rows.push({
      key: `payment-${payment.id}`,
      icon: CheckCircle2,
      title: `Facture ${payment.number} réglée`,
      meta: formatEuroTTC(payment.totalInclVat),
    });
  }

  if (rows.length === 0) {
    return <EmptyState icon={CheckCircle2} title="Rien à régler pour le moment" />;
  }

  return (
    <div>
      {rows.map((row) => (
        <button
          key={row.key}
          onClick={onOpenBilling}
          className="flex w-full items-center gap-3.5 border-b border-divider px-5 py-3.5 text-left last:border-0 hover:bg-row-hover"
        >
          <span
            className={cn(
              "flex h-8 w-8 flex-none items-center justify-center rounded-lg",
              row.danger ? "bg-danger-bg text-danger-fg" : "bg-info-bg text-info-fg",
            )}
          >
            <row.icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-[13.5px] font-bold", row.danger ? "text-danger-fg" : "text-text")}>
              {row.title}
            </span>
            <span className="mt-0.5 block text-[12px] text-text-soft">{row.meta}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
