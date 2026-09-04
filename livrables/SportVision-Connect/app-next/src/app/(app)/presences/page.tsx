"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { presenceStatusTone, PRESENCE_STATUS_LABELS } from "@/components/communication/statusTone";
import { PRESENCE_KIND_LABELS } from "@/lib/types/communication";
import { createClient } from "@/lib/supabase/client";
import { fetchClubPresences, type ClubPresence } from "@/lib/data/club/presences";
import {
  fetchCoverageWishes,
  cancelCoverageWish,
  COVERAGE_TYPE_LABELS,
  COVERAGE_PRIORITY_LABELS,
  COVERAGE_WISH_STATUS_LABELS,
  COVERAGE_WISH_STATUS_TONE,
  type CoverageWish,
} from "@/lib/data/club/coverageWishes";
import { RequestPresenceModal } from "@/components/presences/RequestPresenceModal";

// /presences — présences terrain réelles (table club_presences, migration-connect-v17-club-
// presences.sql, EN ATTENTE D'EXÉCUTION — jusque-là, liste honnêtement vide). Lecture seule :
// c'est SportVision qui planifie/valide, pas le club. Le total "réalisées" est calculé depuis les
// vraies lignes status='completed', plus jamais ctx.subscription.presencesUsed (toujours 0, non
// tracké).
//
// "Demander une présence" (§26-33, priorité remontée par Fouka en post-audit 05/09/2026) ouvre
// désormais RequestPresenceModal (coverage_wishes) au lieu de router.push("/services/new") — le
// club SIGNALE un événement, il ne réserve jamais un opérateur ni ne crée de mission directement
// (create_coverage_wishes s'en charge, décision CM requise avant toute planification réelle).
export default function PresencesPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "presences")) return <LockedModule />;
  return <PresencesScreen />;
}

const CAN_REQUEST_ROLES = new Set(["admin", "president", "communication_manager", "sports_director"]);

function PresencesScreen() {
  const { ctx } = useSession();
  const plan = PLANS[ctx.subscription.planCode];
  const [presences, setPresences] = useState<ClubPresence[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [wishes, setWishes] = useState<CoverageWish[] | null>(null);
  const [wishesError, setWishesError] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const canSeeOperator = ctx.membership.role !== "viewer";
  const canRequest = CAN_REQUEST_ROLES.has(ctx.membership.role);

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      setPresences(await fetchClubPresences(supabase, ctx.organization.id));
    } catch {
      setLoadError(true);
      setPresences([]);
    }
  }

  async function reloadWishes() {
    setWishesError(false);
    try {
      const supabase = createClient();
      setWishes(await fetchCoverageWishes(supabase, ctx.organization.id));
    } catch {
      setWishesError(true);
      setWishes([]);
    }
  }

  async function handleCancelWish(id: string) {
    setCancellingId(id);
    try {
      const supabase = createClient();
      await cancelCoverageWish(supabase, id);
      await reloadWishes();
    } catch {
      setWishesError(true);
    } finally {
      setCancellingId(null);
    }
  }

  useEffect(() => {
    reload();
    reloadWishes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id]);

  const completedCount = (presences ?? []).filter((p) => p.status === "completed").length;
  const pct = plan.seasonPresences > 0 ? Math.min(100, (completedCount / plan.seasonPresences) * 100) : 0;
  const now = new Date();
  const currentMonthLabel = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const thisMonthCount = (presences ?? []).filter((p) => {
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
              {completedCount} présence{completedCount > 1 ? "s" : ""} réalisée{completedCount > 1 ? "s" : ""} sur {plan.seasonPresences}
            </div>
            <div className="mt-1 text-[12.5px] text-[#B9C7EB]">
              Dont {thisMonthCount} réalisée{thisMonthCount > 1 ? "s" : ""} ce mois-ci
            </div>
          </div>
          {canRequest && (
            <Button
              variant="secondary"
              className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
              onClick={() => setShowRequestModal(true)}
            >
              Demander une présence
            </Button>
          )}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.16]">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet" style={{ width: `${pct}%` }} />
        </div>
      </CardPremium>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les présences.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        {presences === null ? (
          <div className="p-9 text-center text-[13.5px] text-text-soft">Chargement…</div>
        ) : presences.length === 0 ? (
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

      {canRequest && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-extrabold tracking-tight">Souhaits de présence</h2>
          {wishesError && (
            <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
              <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
              <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger vos souhaits.</span>
              <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reloadWishes}>
                Réessayer
              </Button>
            </Card>
          )}
          <Card className="overflow-hidden p-0">
            {wishes === null ? (
              <div className="p-9 text-center text-[13.5px] text-text-soft">Chargement…</div>
            ) : wishes.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={Send} title="Aucun souhait envoyé" subtitle="Les événements pour lesquels vous demandez une présence SportVision apparaîtront ici." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-divider bg-surface-alt">
                      {["Type", "Priorité", "Statut", ""].map((h) => (
                        <th key={h} className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wishes.map((w) => (
                      <tr key={w.id} className="border-b border-divider last:border-0 hover:bg-row-hover">
                        <td className="px-5 py-3.5 text-[13.5px] font-bold text-text">{COVERAGE_TYPE_LABELS[w.coverageType]}</td>
                        <td className="px-5 py-3.5 text-[13px] text-text-soft">{COVERAGE_PRIORITY_LABELS[w.priority]}</td>
                        <td className="px-5 py-3.5">
                          <Badge tone={COVERAGE_WISH_STATUS_TONE[w.status]}>{COVERAGE_WISH_STATUS_LABELS[w.status]}</Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {(w.status === "wished" || w.status === "reviewing" || w.status === "selected" || w.status === "sent_to_production") && (
                            <button
                              onClick={() => handleCancelWish(w.id)}
                              disabled={cancellingId === w.id}
                              className="text-[12.5px] font-bold text-danger-fg hover:underline disabled:opacity-50"
                            >
                              {cancellingId === w.id ? "Annulation…" : "Annuler"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {showRequestModal && (
        <RequestPresenceModal
          supabase={createClient()}
          clubId={ctx.organization.id}
          onClose={() => setShowRequestModal(false)}
          onSubmitted={reloadWishes}
        />
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}
