"use client";

import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/communication/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { presenceStatusTone, PRESENCE_STATUS_LABELS } from "@/components/communication/statusTone";
import { getPresencesByOrg } from "@/lib/mock/communication";
import { PRESENCE_KIND_LABELS } from "@/lib/types/communication";

// /presences — présences terrain avec quota. ACTIONS.md § 9. DATA_MODEL.md ne suit le quota
// qu'au niveau saison (Subscription.presencesUsed / Plan.seasonPresences) : la jauge en tête
// d'écran reprend cette donnée réelle ; la liste ci-dessous détaille chaque présence, dont
// celles du mois en cours (voir la note dans le rapport final sur ce choix).
export default function PresencesPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "presences")) return <LockedModule ctx={ctx} />;
  return <PresencesScreen />;
}

function PresencesScreen() {
  const { ctx } = useSession();
  const router = useRouter();
  const plan = PLANS[ctx.subscription.planCode];
  const presences = getPresencesByOrg(ctx.organization.id);
  const canSeeOperator = ctx.membership.role !== "viewer";

  const pct = plan.seasonPresences > 0 ? Math.min(100, (ctx.subscription.presencesUsed / plan.seasonPresences) * 100) : 0;
  const now = new Date();
  const currentMonthLabel = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const thisMonthCount = presences.filter((p) => {
    const d = new Date(p.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && p.status === "completed";
  }).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Présences terrain</h1>
        <p className="mt-1 text-[13.5px] capitalize text-text-soft">{currentMonthLabel}</p>
      </div>

      <CardPremium>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">Vos présences</div>
            <div className="mt-1 text-[22px] font-extrabold tracking-tight">
              {ctx.subscription.presencesUsed} présences réalisées sur {plan.seasonPresences} cette saison
            </div>
            <div className="mt-1 text-[12.5px] text-[#B9C7EB]">
              Dont {thisMonthCount} réalisée{thisMonthCount > 1 ? "s" : ""} ce mois-ci
            </div>
          </div>
          <Button
            variant="secondary"
            className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
            onClick={() => router.push("/services/new")}
          >
            Demander une présence
          </Button>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.16]">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet" style={{ width: `${pct}%` }} />
        </div>
      </CardPremium>

      <Card className="overflow-hidden p-0">
        {presences.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={CalendarClock} title="Aucune présence programmée" subtitle="Vos prochaines présences terrain apparaîtront ici." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-divider bg-surface-alt">
                  {["Date", "Événement", "Type", ...(canSeeOperator ? ["Opérateur"] : []), "Statut"].map((h) => (
                    <th key={h} className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {presences.map((p) => (
                  <tr key={p.id} className="border-b border-divider last:border-0 hover:bg-row-hover">
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-text-soft">{formatDate(p.date)}</td>
                    <td className="px-5 py-3.5 text-[13.5px] font-bold text-text">{p.eventLabel}</td>
                    <td className="px-5 py-3.5 text-[13px] text-text-soft">{PRESENCE_KIND_LABELS[p.kind]}</td>
                    {canSeeOperator && (
                      <td className="px-5 py-3.5 text-[13px] text-text-soft">{p.operatorName ?? "À confirmer"}</td>
                    )}
                    <td className="px-5 py-3.5">
                      <Badge tone={presenceStatusTone(p.status)}>{PRESENCE_STATUS_LABELS[p.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}
