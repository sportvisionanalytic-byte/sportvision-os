"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { formatDateLong } from "@/lib/prestations/format";
import {
  AGENT_STATUS_LABEL,
  AGENT_TIER_LABEL,
  AGENT_TIER_PLANS,
  type AgentSubscriptionInfo,
  type AgentTierPlan,
  fetchAgentSubscriptionInfo,
} from "@/lib/supabase/agentSubscription";

// Mon abonnement (Espace particulier, compte Agent) — voir migration-connect-v57-abonnement-
// agent.sql pour le contrat exact de connect_agent_subscription_status(). Toute action d'écriture
// passe par une edge function (create-agent-subscription-checkout / manage-agent-subscription /
// connect-agent-billing-portal) : cette page ne pose JAMAIS elle-même un statut d'abonnement —
// l'état affiché ne devient définitif qu'une fois le webhook Stripe traité (MASTER-CONNECT-V1.md
// §25), d'où le rafraîchissement différé après un retour de paiement réussi ci-dessous.
export function AbonnementView({
  initialInfo,
  returnStatus,
}: {
  initialInfo: AgentSubscriptionInfo;
  returnStatus: "succes" | "annule" | null;
}) {
  const router = useRouter();
  const [info, setInfo] = useState(initialInfo);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reactivateBusy, setReactivateBusy] = useState(false);

  // Le webhook Stripe (checkout.session.completed) confirme l'activation en tâche de fond —
  // souvent quelques centaines de ms après la redirection, parfois un peu plus. Un seul
  // rafraîchissement différé après un retour "succes" suffit à rattraper la quasi-totalité des
  // cas sans transformer cette page en poll continu ; l'utilisateur peut de toute façon recharger
  // manuellement si besoin (jamais un statut "payé" affiché avant confirmation réelle).
  useEffect(() => {
    if (returnStatus !== "succes") return;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const fresh = await fetchAgentSubscriptionInfo(supabase);
      setInfo(fresh);
      router.refresh();
    }, 2500);
    return () => clearTimeout(t);
  }, [returnStatus, router]);

  const usagePct = info.limit > 0 ? Math.min(100, Math.round((info.athletesCount / info.limit) * 100)) : 0;
  const isSubscribed = info.tier !== "gratuit" && (info.status === "active" || info.status === "past_due");

  async function refresh() {
    const supabase = createClient();
    const fresh = await fetchAgentSubscriptionInfo(supabase);
    setInfo(fresh);
  }

  async function subscribe(tier: AgentTierPlan["tier"]) {
    setBusyTier(tier);
    setError(null);
    const supabase = createClient();
    const fnName = isSubscribed ? "manage-agent-subscription" : "create-agent-subscription-checkout";
    const body = isSubscribed ? { action: "change_tier", tier } : { tier };
    const { data, error: fnError } = await supabase.functions.invoke(fnName, { body });
    setBusyTier(null);
    if (fnError || data?.error) {
      setError(data?.error || "Impossible de traiter votre demande pour le moment.");
      return;
    }
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    // Changement de palier via l'API directe : pas de redirection, on rafraîchit l'état une fois
    // le webhook customer.subscription.updated très probablement passé.
    setTimeout(refresh, 1500);
  }

  async function openBillingPortal() {
    setPortalBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("connect-agent-billing-portal", { body: {} });
    setPortalBusy(false);
    if (fnError || data?.error || !data?.url) {
      setError(data?.error || "Le portail de facturation est momentanément indisponible.");
      return;
    }
    window.location.href = data.url;
  }

  async function cancelSubscription() {
    setCancelBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("manage-agent-subscription", { body: { action: "cancel" } });
    setCancelBusy(false);
    setConfirmingCancel(false);
    if (fnError || data?.error) {
      setError(data?.error || "Impossible de résilier votre abonnement pour le moment.");
      return;
    }
    setTimeout(refresh, 1500);
  }

  async function reactivateSubscription() {
    setReactivateBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("manage-agent-subscription", { body: { action: "reactivate" } });
    setReactivateBusy(false);
    if (fnError || data?.error) {
      setError(data?.error || "Impossible d'annuler la résiliation pour le moment.");
      return;
    }
    setTimeout(refresh, 1500);
  }

  return (
    <div className="flex max-w-[880px] flex-col gap-7 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mon abonnement</h1>
        <p className="max-w-[620px] text-[15px] text-text-tertiary">
          Le nombre de sportifs que vous pouvez suivre en tant qu&apos;agent / représentant dépend de votre palier.
        </p>
      </div>

      {returnStatus === "succes" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">hourglass_top</span>
          <span className="text-[13px] leading-relaxed text-text-secondary">
            Paiement reçu par Stripe — confirmation de votre abonnement en cours. Cette page se met à jour automatiquement.
          </span>
        </div>
      )}
      {returnStatus === "annule" && (
        <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">info</span>
          <span className="text-[13px] leading-relaxed text-text-tertiary">Paiement annulé — aucun changement n&apos;a été effectué.</span>
        </div>
      )}

      {/* ============ ÉTAT ACTUEL ============ */}
      <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(168,85,247,.5), rgba(34,211,238,.24) 60%, transparent)" }}>
        <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white">
              {AGENT_TIER_LABEL[info.tier][0]}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="font-sora text-[19px] font-semibold">Palier {AGENT_TIER_LABEL[info.tier]}</span>
              <span className="text-[13px] text-text-tertiary">
                {info.status === "past_due" ? "Paiement en échec — Stripe va retenter automatiquement." : AGENT_STATUS_LABEL[info.status]}
                {info.currentPeriodEnd && info.status === "active" && !info.cancelAtPeriodEnd && ` · renouvellement le ${formatDateLong(info.currentPeriodEnd)}`}
              </span>
            </div>
            {info.cancelAtPeriodEnd && info.currentPeriodEnd && (
              <span className="ml-auto flex-none rounded-sv-pill bg-attente-bg px-2.5 py-1 text-[11px] font-medium text-attente">
                Résiliation prévue le {formatDateLong(info.currentPeriodEnd)}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-text-secondary">
                {info.athletesCount} sportif{info.athletesCount > 1 ? "s" : ""} suivi{info.athletesCount > 1 ? "s" : ""} en tant qu&apos;agent
              </span>
              <span className="text-text-tertiary">{info.athletesCount} / {info.limit}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[.08]">
              <div
                className="h-full rounded-full bg-sv-gradient transition-[width] duration-300"
                style={{ width: `${usagePct}%` }}
              />
            </div>
            {!info.canAcceptMore && (
              <span className="text-[12.5px] leading-relaxed text-attente">
                Vous avez atteint la limite de votre palier — les nouvelles demandes d&apos;accès agent ne pourront pas être
                acceptées tant que vous n&apos;aurez pas changé de palier.
              </span>
            )}
          </div>

          {isSubscribed && (
            <div className="flex flex-wrap gap-2.5 border-t border-border pt-4">
              <Button variant="secondary" onClick={openBillingPortal} loading={portalBusy}>
                Gérer ma facturation
              </Button>
              {info.cancelAtPeriodEnd ? (
                <Button variant="secondary" onClick={reactivateSubscription} loading={reactivateBusy}>
                  Annuler la résiliation
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
                  Résilier mon abonnement
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
          <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{error}</span>
        </div>
      )}

      {/* ============ PALIERS ============ */}
      <div className="flex flex-col gap-3.5">
        <h2 className="font-sora text-[17px] font-semibold">Paliers</h2>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {AGENT_TIER_PLANS.map((plan) => {
            const isCurrent = isSubscribed && info.tier === plan.tier;
            return (
              <div
                key={plan.tier}
                className={`flex flex-col gap-3.5 rounded-sv-card border p-5 ${
                  isCurrent ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.08)]" : "border-border bg-surface"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-sora text-[17px] font-semibold">{plan.label}</span>
                  {isCurrent && (
                    <span className="rounded-sv-pill bg-affiliations-bg px-2 py-0.5 text-[11px] font-medium text-affiliations">Actuel</span>
                  )}
                </div>
                <span className="font-sora text-[24px] font-bold">{plan.priceLabel}</span>
                <span className="text-[13px] text-text-tertiary">{plan.rangeLabel}</span>
                <div className="flex flex-col gap-2">
                  {plan.benefits.map((b) => (
                    <div key={b} className="flex items-start gap-2">
                      <span className="material-symbols-rounded mt-0.5 !text-[16px] text-affiliations" aria-hidden="true">check</span>
                      <span className="text-[13px] leading-snug text-text-secondary">{b}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant={isCurrent ? "secondary" : "primary"}
                  disabled={isCurrent}
                  loading={busyTier === plan.tier}
                  onClick={() => subscribe(plan.tier)}
                  className="mt-auto w-full"
                >
                  {isCurrent ? "Palier actuel" : isSubscribed ? "Passer à ce palier" : "Souscrire"}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-[18px] py-4">
          <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">info</span>
          <span className="text-[13px] leading-relaxed text-text-tertiary">
            Plus de 20 sportifs suivis ? Contactez SportVision directement, aucune inscription en ligne au-delà du palier Pro.
          </span>
        </div>
      </div>

      {confirmingCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-6" onClick={() => !cancelBusy && setConfirmingCancel(false)}>
          <div className="flex max-h-[90vh] w-full max-w-[420px] flex-col gap-4 overflow-y-auto rounded-sv-modal border border-border bg-bg-elevated p-6" onClick={(e) => e.stopPropagation()}>
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-danger-bg">
              <span className="material-symbols-rounded !text-[24px] text-danger" aria-hidden="true">warning</span>
            </span>
            <div className="flex flex-col gap-2">
              <span className="font-sora text-[19px] font-semibold">Résilier votre abonnement ?</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary">
                Vous gardez l&apos;accès à votre palier {AGENT_TIER_LABEL[info.tier]} jusqu&apos;à la fin de la période déjà
                payée{info.currentPeriodEnd ? ` (${formatDateLong(info.currentPeriodEnd)})` : ""}. Ensuite, vous repassez au
                palier Gratuit (2 sportifs maximum).
              </span>
            </div>
            <div className="mt-1 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelBusy}
                className="flex-1 rounded-sv border border-border-strong bg-surface py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={cancelSubscription}
                disabled={cancelBusy}
                className="flex-1 rounded-sv border border-danger-border bg-danger-bg py-2.5 font-sora text-[14px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]"
              >
                {cancelBusy ? "…" : "Résilier"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
