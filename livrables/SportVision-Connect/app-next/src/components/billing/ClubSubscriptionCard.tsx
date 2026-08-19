"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
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
//
// Redessiné le 19/08/2026 : l'ancienne version répétait "Club+ Gratuit" trois fois (titre,
// badge, champ "Formule") et proposait 4 boutons plats indifférenciés (Start/Performance ×
// 12 mois/sans engagement) suivis d'un bouton "S'abonner" séparé — peu lisible. Remplacé par
// deux cartes d'offre (une par formule), chacune avec son propre bascule d'engagement et son
// propre bouton, alignées sur la présentation déjà utilisée sur la vitrine publique
// (club-plus.html) et sur le catalogue de prestations (ClubOfferCard.tsx).
const PLAN_LABELS: Record<string, string> = { free: "Club+ Gratuit", club: "Club+ Start", performance: "Club+ Performance" };
const ENGAGEMENT_LABELS: Record<string, string> = { "12mois": "Engagement 12 mois", sans: "Sans engagement" };

interface OfferTier {
  plan: "club" | "performance";
  name: string;
  priceCommitted: number;
  priceFree: number;
  credits: number;
  maxUsers: number | null;
  maxTeams: number | null;
  discountPct: number;
  featured?: boolean;
}

const TIERS: OfferTier[] = [
  { plan: "club", name: "Club+ Start", priceCommitted: 49, priceFree: 59, credits: 10, maxUsers: 5, maxTeams: 2, discountPct: 5 },
  { plan: "performance", name: "Club+ Performance", priceCommitted: 129, priceFree: 139, credits: 40, maxUsers: null, maxTeams: null, discountPct: 10, featured: true },
];

export function ClubSubscriptionCard({ clubId }: { clubId: string }) {
  const [info, setInfo] = useState<ClubSubscriptionInfo | null | undefined>(undefined);
  const [engagement, setEngagement] = useState<Record<string, "12mois" | "sans">>({ club: "12mois", performance: "12mois" });
  const [submittingPlan, setSubmittingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchClubSubscriptionInfo(supabase, clubId).then(setInfo);
  }, [clubId]);

  async function startCheckout(tier: OfferTier) {
    setSubmittingPlan(tier.plan);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("create-clubplus-subscription-checkout", {
      body: { club_id: clubId, plan: tier.plan, engagement: engagement[tier.plan] },
    });
    if (fnError || data?.error) {
      setSubmittingPlan(null);
      setError(data?.error || "Impossible de démarrer le paiement. Réessayez.");
      return;
    }
    window.location.href = data.url;
  }

  async function openBillingPortal() {
    setSubmittingPlan("portal");
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("clubplus-billing-portal", {
      body: { club_id: clubId },
    });
    if (fnError || data?.error) {
      setSubmittingPlan(null);
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
          <div className="mt-1 text-[12.5px] text-text-soft">
            {info.engagement ? ENGAGEMENT_LABELS[info.engagement] ?? info.engagement : "Sans engagement"} ·{" "}
            {info.creditsBalance} / {info.creditsMonthly} crédits restants ce mois-ci
          </div>
        </div>
        {info.hasActiveStripeSubscription ? (
          <Badge tone="success">Abonnement actif</Badge>
        ) : info.plan === "free" ? (
          <Badge tone="neutral">Plan Gratuit</Badge>
        ) : (
          <Badge tone="warning">{info.pilotMode ? "Accès pilote (offert)" : "Aucun abonnement Stripe"}</Badge>
        )}
      </div>

      {error && <p className="mt-4 text-[12.5px] font-semibold text-danger-fg">{error}</p>}

      {info.hasActiveStripeSubscription ? (
        <Button variant="secondary" onClick={openBillingPortal} disabled={submittingPlan !== null} className="mt-5">
          <CreditCard className="h-3.5 w-3.5" aria-hidden />
          {submittingPlan === "portal" ? "Ouverture…" : "Gérer mon abonnement"}
        </Button>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {TIERS.map((tier) => {
            const eng = engagement[tier.plan] ?? "12mois";
            const price = eng === "12mois" ? tier.priceCommitted : tier.priceFree;
            const submitting = submittingPlan === tier.plan;
            return (
              <div
                key={tier.plan}
                className={cn(
                  "flex flex-col gap-3 rounded-sv-card border p-4",
                  tier.featured ? "border-brand-blue-electric bg-info-bg" : "border-border-strong",
                )}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-extrabold tracking-tight text-text">{tier.name}</span>
                    {tier.featured && <Badge tone="accent">Populaire</Badge>}
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-[22px] font-extrabold tracking-tight text-text">{price} €</span>
                    <span className="text-[12px] font-semibold text-text-soft">/ mois</span>
                  </div>
                </div>

                <div className="flex gap-1.5" role="group" aria-label={`Engagement — ${tier.name}`}>
                  {(["12mois", "sans"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setEngagement((prev) => ({ ...prev, [tier.plan]: opt }))}
                      className={cn(
                        "flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-colors",
                        eng === opt
                          ? "border-brand-blue-electric bg-brand-blue-electric/10 text-brand-blue-electric"
                          : "border-border-strong text-text-faint hover:border-brand-blue-electric",
                      )}
                    >
                      {opt === "12mois" ? "12 mois" : "Sans engagement"}
                    </button>
                  ))}
                </div>

                <ul className="flex flex-col gap-1.5 text-[12px] text-text-soft">
                  <FeatureLine>{tier.credits} crédits inclus / mois</FeatureLine>
                  <FeatureLine>{tier.maxUsers ? `Jusqu'à ${tier.maxUsers} utilisateurs` : "Utilisateurs illimités"}</FeatureLine>
                  <FeatureLine>{tier.maxTeams ? `Jusqu'à ${tier.maxTeams} équipes` : "Équipes illimitées"}</FeatureLine>
                  <FeatureLine>{tier.discountPct}% de remise sur les prestations éligibles</FeatureLine>
                </ul>

                <Button
                  variant={tier.featured ? "primary" : "secondary"}
                  className="mt-auto w-full"
                  disabled={submittingPlan !== null}
                  loading={submitting}
                  onClick={() => startCheckout(tier)}
                >
                  {submitting ? "Redirection…" : `S'abonner — ${price} € / mois`}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <Check className="mt-0.5 h-3 w-3 flex-none text-success-fg" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
