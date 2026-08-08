"use client";

import { useRouter } from "next/navigation";
import { Eye, Heart, Radar, Users } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/communication/MetricCard";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { getAnalyticsSummary, getPublicationsByOrg } from "@/lib/mock/communication";
import { PLATFORM_LABELS } from "@/lib/types/communication";

// /analytics — 4 métriques resserrées. ACTIONS.md § 9 : « portée, vues, engagement, abonnés —
// chacune avec sa progression », puis « Vos meilleures publications » (3 entrées).
export default function AnalyticsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "analytics")) return <LockedModule />;
  return <AnalyticsScreen organizationId={ctx.organization.id} />;
}

function AnalyticsScreen({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const summary = getAnalyticsSummary(organizationId);
  const best = getPublicationsByOrg(organizationId)
    .filter((p) => p.status === "published" && typeof p.reach === "number")
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Statistiques</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">Performance des 30 derniers jours.</p>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <MetricCard icon={Radar} label="Portée" value={summary.reach.toLocaleString("fr-FR")} deltaPct={summary.reachDeltaPct} />
          <MetricCard icon={Eye} label="Vues" value={summary.views.toLocaleString("fr-FR")} deltaPct={summary.viewsDeltaPct} />
          <MetricCard icon={Heart} label="Engagement" value={summary.engagement.toLocaleString("fr-FR")} deltaPct={summary.engagementDeltaPct} />
          <MetricCard icon={Users} label="Abonnés" value={summary.followers.toLocaleString("fr-FR")} deltaPct={summary.followersDeltaPct} />
        </div>
      ) : (
        <EmptyState icon={Radar} title="Pas encore de statistiques" subtitle="Elles apparaîtront dès vos premières publications." />
      )}

      <Card>
        <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">Vos meilleures publications</div>
        {best.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Radar} title="Aucune publication mesurée" subtitle="Les statistiques arrivent après la première publication en ligne." />
          </div>
        ) : (
          best.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/communication/publications/${p.id}`)}
              className="flex w-full items-center gap-3.5 border-b border-divider px-5 py-3.5 text-left last:border-0 hover:bg-row-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-text">{p.title}</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">{PLATFORM_LABELS[p.platform]}</span>
              </span>
              <span className="w-28 flex-none text-right text-[12.5px] font-bold text-text">
                {(p.reach ?? 0).toLocaleString("fr-FR")} portée
              </span>
              <span className="w-32 flex-none text-right text-[12.5px] font-bold text-text-soft">
                {(p.engagement ?? 0).toLocaleString("fr-FR")} interactions
              </span>
            </button>
          ))
        )}
      </Card>
    </div>
  );
}
