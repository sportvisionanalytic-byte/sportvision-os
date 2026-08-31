"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Eye, FileBarChart, Heart, Radar } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { LockedModule } from "@/components/ui/LockedModule";
import { MetricCard } from "@/components/communication/MetricCard";
import { EmptyState } from "@/components/communication/EmptyState";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { cn } from "@/lib/cn";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import {
  buildMonthlyReports,
  fetchContenusPubliesAvecStats,
  formatReportPeriod,
  sumStat,
  type ContenuAvecStats,
  type MonthlyReport,
} from "@/lib/data/shared/contenu-stats";

// /reports — remplace le mock (lib/mock/communication.ts, type Report) par un vrai récapitulatif
// mensuel construit sur `contenus` + `contenu_stats` (migration-cm-contenu-stats.sql, Phase 5 du
// plan Tier C). Décidé avec Fouka (10/08) : pas d'intégration Metricool réelle pour l'instant —
// la donnée de portée/vues/engagement vient d'une saisie manuelle du CM, contenu par contenu.
//
// Changement assumé par rapport au mock qu'il remplace : celui-ci incluait un résumé narratif
// rédigé ("summary"), des objectifs, des recommandations et un plan du mois suivant. Aucune de
// ces quatre sections n'a de source réelle — ce serait un texte libre que le CM rédigerait à la
// main, dans une table qui n'existe pas et qui est hors périmètre de cette phase (limitée à
// contenus + contenu_stats). Plutôt que d'inventer ce texte, ce rapport ne montre que ce qui est
// mesurable : contenus publiés par type, portée/vues/engagement agrégés (jamais 0 si non
// renseigné — sumStat renvoie null), et la meilleure publication du mois. Le faux bouton
// "Télécharger le rapport" du mock (qui affichait un toast de succès sans jamais rien produire)
// est remplacé par une copie presse-papiers réelle du résumé chiffré — une action qui fait
// vraiment ce qu'elle annonce, plutôt qu'un PDF simulé. Un futur chantier "rapport rédigé par le
// CM" pourra ajouter la partie narrative sans remettre en cause cette page.
export default function ReportsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "reports")) return <LockedModule />;
  return <ReportsGate />;
}

function ReportsGate() {
  const { ctx } = useSession();
  const resolution = useClientId();

  // Message dédié — même correctif et même raison exacte que messages/page.tsx (31/08/2026,
  // audit complet) : useClientId() "locked" est définitif pour ce type d'espace, jamais débloqué
  // par un changement de contrat, contrairement à ce que sous-entend le message générique de
  // LockedModule.
  if (resolution.status === "locked") {
    return (
      <LockedModule message="Les rapports mensuels ne sont pas encore disponibles pour ce type d'espace, quel que soit votre contrat." />
    );
  }
  if (resolution.status === "loading") {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[24px] font-extrabold tracking-tight">Rapports mensuels</h1>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="max-w-md text-[13.5px] text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Rapports.
          </div>
        </Card>
      </div>
    );
  }
  return <ReportsScreen clientId={resolution.clientId} />;
}

function ReportsScreen({ clientId }: { clientId: string }) {
  const { toasts, showToast } = useToast();
  const [allItems, setAllItems] = useState<ContenuAvecStats[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string>();

  async function reload() {
    setLoadError(false);
    setAllItems(null);
    try {
      const supabase = createClient();
      const items = await fetchContenusPubliesAvecStats(supabase, clientId);
      setAllItems(items);
      const reports = buildMonthlyReports(items);
      setSelectedPeriod((prev) => prev ?? reports[0]?.period);
    } catch {
      setLoadError(true);
      setAllItems([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight">Rapports mensuels</h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les rapports.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {allItems === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      ) : (
        <ReportsBody
          allItems={allItems}
          selectedPeriod={selectedPeriod}
          onSelect={setSelectedPeriod}
          onCopy={(report) => {
            copyReportToClipboard(report);
            showToast(`Rapport ${formatReportPeriod(report.period)} copié.`);
          }}
        />
      )}

      <ToastViewport toasts={toasts} />
    </div>
  );
}

function ReportsBody({
  allItems,
  selectedPeriod,
  onSelect,
  onCopy,
}: {
  allItems: ContenuAvecStats[];
  selectedPeriod: string | undefined;
  onSelect: (period: string) => void;
  onCopy: (report: MonthlyReport) => void;
}) {
  const reports = buildMonthlyReports(allItems);
  const selected = reports.find((r) => r.period === selectedPeriod) ?? reports[0];

  if (reports.length === 0 || !selected) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="Aucun rapport disponible pour le moment"
        subtitle="Votre premier rapport mensuel apparaîtra après votre première publication."
      />
    );
  }

  const reach = sumStat(selected.items, "portee");
  const views = sumStat(selected.items, "vues");
  const engagement = sumStat(selected.items, "engagement");
  const byType = new Map<string, number>();
  selected.items.forEach((c) => {
    const label = c.typeContenu ?? "Autre";
    byType.set(label, (byType.get(label) ?? 0) + 1);
  });
  const best = [...selected.items]
    .filter((c) => c.stats?.portee != null)
    .sort((a, b) => (b.stats?.portee ?? 0) - (a.stats?.portee ?? 0))[0];
  const fmt = (n: number | null) => (n != null ? n.toLocaleString("fr-FR") : "—");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-row gap-2.5 overflow-x-auto lg:flex-col">
        {reports.map((r) => (
          <button
            key={r.period}
            onClick={() => onSelect(r.period)}
            className={cn(
              "flex-none rounded-xl border p-3.5 text-left transition-colors lg:flex-auto",
              r.period === selected.period ? "border-brand-blue bg-info-bg" : "border-border bg-surface hover:border-brand-blue-electric",
            )}
          >
            <div className={cn("text-[13.5px] font-extrabold capitalize", r.period === selected.period ? "text-info-fg" : "text-text")}>
              {formatReportPeriod(r.period)}
            </div>
            <div className="mt-1 text-[11.5px] text-text-soft">
              {r.items.length} contenu{r.items.length > 1 ? "s" : ""} publié{r.items.length > 1 ? "s" : ""}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <CardPremium>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">Rapport mensuel</div>
              <div className="mt-1 text-[22px] font-extrabold capitalize tracking-tight">{formatReportPeriod(selected.period)}</div>
            </div>
            <Button
              variant="secondary"
              className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
              onClick={() => onCopy(selected)}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copier le résumé
            </Button>
          </div>
        </CardPremium>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <MetricCard icon={Radar} label="Portée" value={fmt(reach)} hint="Saisi manuellement" />
          <MetricCard icon={Eye} label="Vues" value={fmt(views)} hint="Saisi manuellement" />
          <MetricCard icon={Heart} label="Engagement" value={fmt(engagement)} hint="Saisi manuellement" />
        </div>

        <Card className="p-5">
          <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Contenus publiés</div>
          <div className="mt-2.5 flex flex-col gap-2">
            {[...byType.entries()].map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-[13.5px]">
                <span className="text-text-soft">{label}</span>
                <span className="font-extrabold text-text">{count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Meilleure publication</div>
          {best ? (
            <>
              <div className="mt-2 text-[14.5px] font-extrabold text-text">{best.titre}</div>
              <div className="mt-0.5 text-[12.5px] text-text-soft">
                {fmt(best.stats?.portee ?? null)} portée · {fmt(best.stats?.engagement ?? null)} interactions · saisi manuellement
              </div>
            </>
          ) : (
            <div className="mt-2 text-[13px] text-text-soft">Aucune statistique saisie pour ce mois-ci.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function copyReportToClipboard(report: MonthlyReport) {
  const reach = sumStat(report.items, "portee");
  const views = sumStat(report.items, "vues");
  const engagement = sumStat(report.items, "engagement");
  const fmt = (n: number | null) => (n != null ? n.toLocaleString("fr-FR") : "non renseigné");
  const lines = [
    `Rapport ${formatReportPeriod(report.period)}`,
    `Contenus publiés : ${report.items.length}`,
    `Portée : ${fmt(reach)} (saisi manuellement)`,
    `Vues : ${fmt(views)} (saisi manuellement)`,
    `Engagement : ${fmt(engagement)} (saisi manuellement)`,
  ];
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
  }
}
