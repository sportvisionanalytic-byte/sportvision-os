"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import { fetchClubSubscriptionInfo, type ClubSubscriptionInfo } from "@/lib/data/club/subscription";

// "Mon offre" (CLUB-PLUS-PRODUCT-BIBLE.md §19) — audit complet Club+ du 17/08/2026 : aucune
// section de ce type n'existait, et les deux edge functions Stripe déjà écrites pour elle
// (create-clubplus-subscription-checkout, clubplus-billing-portal) n'étaient invoquées nulle
// part. Décision Fouka (17/08) : self-service complet — un admin de club peut souscrire un vrai
// abonnement Stripe ici, ou gérer un abonnement déjà actif via le Portail de facturation Stripe.
// Seul un admin peut voir ce bloc : create-clubplus-subscription-checkout et clubplus-billing-
// portal rejettent tout autre rôle côté serveur (club_members.role = 'admin' strictement) — ce
// n'est donc pas une simple préférence d'affichage, la vérification serveur fait de toute façon
// foi si ce composant était monté par erreur pour un autre rôle.
const PLAN_LABELS: Record<string, string> = { free: "Club+ Gratuit", club: "Club+ Start", performance: "Club+ Performance" };
const ENGAGEMENT_LABELS: Record<string, string> = { "12mois": "Engagement 12 mois", sans: "Sans engagement" };

const OFFERS: { plan: string; engagement: string; label: string; price: number }[] = [
  { plan: "club", engagement: "12mois", label: "Club+ Start — 12 mois", price: 49 },
  { plan: "club", engagement: "sans", label: "Club+ Start — sans engagement", price: 59 },
  { plan: "performance", engagement: "12mois", label: "Club+ Performance — 12 mois", price: 129 },
  { plan: "performance", engagement: "sans", label: "Club+ Performance — sans engagement", price: 139 },
];

export function ClubSubscriptionCard({ clubId }: { clubId: string }) {
  const [info, setInfo] = useState<ClubSubscriptionInfo | null | undefined>(undefined);
  const [selected, setSelected] = useState(OFFERS[0]!);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchClubSubscriptionInfo(supabase, clubId).then(setInfo);
  }, [clubId]);

  async function startCheckout() {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-clubplus-subscription-checkout", {
      body: { club_id: clubId, plan: selected.plan, engagement: selected.engagement },
    });
    if (fnError || data?.error) {
      setSubmitting(false);
      setError(data?.error || "Impossible de démarrer le paiement. Réessayez.");
      return;
    }
    window.location.href = data.url;
  }

  async function openBillingPortal() {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("clubplus-billing-portal", {
      body: { club_id: clubId },
    });
    if (fnError || data?.error) {
      setSubmitting(false);
      setError(data?.error || "Impossible d'ouvrir le portail de facturation. Réessayez.");
      return;
    }
    window.location.href = data.url;
  }

  if (info === undefined) {
    return (
      <Card className="p-5">
        <div className="text-[13px] text-text-soft">Chargement de votre offre…</div>
      </Card>
    );
  }

  if (info === null) return null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Mon offre</div>
          <h2 className="mt-1 text-[19px] font-extrabold tracking-tight">{PLAN_LABELS[info.plan] ?? info.plan}</h2>
        </div>
        {info.hasActiveStripeSubscription ? (
          <Badge tone="success">Abonnement actif</Badge>
        ) : info.plan === "free" ? (
          <Badge tone="neutral">Plan Gratuit</Badge>
        ) : (
          <Badge tone="warning">{info.pilotMode ? "Accès pilote (offert)" : "Aucun abonnement Stripe"}</Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <InfoField label="Formule" value={PLAN_LABELS[info.plan] ?? info.plan} />
        <InfoField label="Engagement" value={info.engagement ? ENGAGEMENT_LABELS[info.engagement] ?? info.engagement : "—"} />
        <InfoField label="Crédits" value={`${info.creditsBalance} / ${info.creditsMonthly} restants ce mois-ci`} />
      </div>

      {error && <p className="mt-4 text-[12.5px] font-semibold text-danger-fg">{error}</p>}

      {info.hasActiveStripeSubscription ? (
        <Button variant="secondary" onClick={openBillingPortal} disabled={submitting} className="mt-5">
          <CreditCard className="h-3.5 w-3.5" aria-hidden />
          {submitting ? "Ouverture…" : "Gérer mon abonnement"}
        </Button>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {OFFERS.map((offer) => (
              <button
                key={`${offer.plan}-${offer.engagement}`}
                type="button"
                onClick={() => setSelected(offer)}
                className={`rounded-xl border px-3.5 py-2.5 text-left text-[12.5px] font-bold transition-colors ${
                  selected.plan === offer.plan && selected.engagement === offer.engagement
                    ? "border-brand-blue-electric bg-info-bg text-text"
                    : "border-border-strong text-text-soft hover:border-brand-blue-electric"
                }`}
              >
                {offer.label}
                <span className="block text-[11px] font-semibold text-text-faint">{offer.price} € / mois</span>
              </button>
            ))}
          </div>
          <Button onClick={startCheckout} disabled={submitting} className="w-fit">
            {submitting ? "Redirection…" : `S'abonner — ${selected.price} € / mois`}
          </Button>
        </div>
      )}
    </Card>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-text-faint">{label}</div>
      <div className="mt-0.5 text-[13px] font-extrabold text-text">{value}</div>
    </div>
  );
}
