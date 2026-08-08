"use client";

import { useState } from "react";
import { Download, FileBarChart } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/communication/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { cn } from "@/lib/cn";
import { getReportsByOrg } from "@/lib/mock/communication";

// /reports — rapports mensuels, réservés à Full Communication (DATA_MODEL.md § Report).
// ACTIONS.md § 9 : carte de mois → charge le rapport, en-tête premium avec téléchargement PDF.
export default function ReportsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "reports")) return <LockedModule ctx={ctx} />;
  return <ReportsScreen organizationId={ctx.organization.id} />;
}

function ReportsScreen({ organizationId }: { organizationId: string }) {
  const { toasts, showToast } = useToast();
  const reports = getReportsByOrg(organizationId);
  const [selectedId, setSelectedId] = useState(reports[0]?.id);
  const selected = reports.find((r) => r.id === selectedId);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Rapports mensuels</h1>
      </div>

      {reports.length === 0 || !selected ? (
        <EmptyState
          icon={FileBarChart}
          title="Aucun rapport disponible pour le moment"
          subtitle="Votre premier rapport mensuel sera généré après votre premier mois d'accompagnement."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div className="flex flex-row gap-2.5 overflow-x-auto lg:flex-col">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "flex-none rounded-xl border p-3.5 text-left transition-colors lg:flex-auto",
                  r.id === selectedId ? "border-brand-blue bg-info-bg" : "border-border bg-surface hover:border-brand-blue-electric",
                )}
              >
                <div className={cn("text-[13.5px] font-extrabold capitalize", r.id === selectedId ? "text-info-fg" : "text-text")}>
                  {formatPeriod(r.period)}
                </div>
                <div className="mt-1">
                  <Badge tone={r.status === "available" ? "info" : "neutral"}>{r.status === "available" ? "Nouveau" : "Consulté"}</Badge>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <CardPremium>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">Rapport mensuel</div>
                  <div className="mt-1 text-[22px] font-extrabold capitalize tracking-tight">{formatPeriod(selected.period)}</div>
                </div>
                <Button
                  variant="secondary"
                  className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
                  onClick={() => showToast(`Rapport ${formatPeriod(selected.period)} téléchargé.`)}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Télécharger le rapport
                </Button>
              </div>
            </CardPremium>

            <Card className="p-5">
              <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Résumé du mois</div>
              <p className="mt-2 text-[14px] leading-relaxed text-text">{selected.summary}</p>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="p-5">
                <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Objectifs</div>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {selected.objectives.map((o) => (
                    <li key={o} className="flex gap-2 text-[13.5px] leading-relaxed text-text-soft">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-blue-electric" />
                      {o}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-5">
                <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Contenus réalisés</div>
                <div className="mt-2.5 flex flex-col gap-2">
                  {selected.contentsProduced.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-[13.5px]">
                      <span className="text-text-soft">{c.label}</span>
                      <span className="font-extrabold text-text">{c.count}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Meilleure publication</div>
              <div className="mt-2 text-[14.5px] font-extrabold text-text">{selected.bestPublicationTitle}</div>
              <div className="mt-0.5 text-[12.5px] text-text-soft">{selected.bestPublicationStats}</div>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="p-5">
                <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Recommandations</div>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {selected.recommendations.map((r) => (
                    <li key={r} className="flex gap-2 text-[13.5px] leading-relaxed text-text-soft">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-violet" />
                      {r}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-5">
                <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Plan du mois suivant</div>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {selected.nextMonthPlan.map((n) => (
                    <li key={n} className="flex gap-2 text-[13.5px] leading-relaxed text-text-soft">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-cyan" />
                      {n}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}

      <ToastViewport toasts={toasts} />
    </div>
  );
}

function formatPeriod(period: string): string {
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}
