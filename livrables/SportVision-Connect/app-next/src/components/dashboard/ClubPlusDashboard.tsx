"use client";

import { Calendar, FileUp, Images, Sparkles, UserPlus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// Tableau de bord — variante Club+ (Essentiel / Club+ Start / Club+ Performance, type club).
// Voir ACTIONS.md § 5 et DATA_MODEL.md pour les quotas. Écran de référence pour les
// conventions du scaffold ; copiez ses patterns pour les autres variantes de dashboard
// (src/components/dashboard/) plutôt que d'en inventer de nouveaux.

const QUICK_ACTIONS = [
  { icon: Sparkles, label: "Demander un visuel" },
  { icon: Calendar, label: "Ajouter un événement" },
  { icon: FileUp, label: "Importer un document" },
  { icon: Images, label: "Consulter les contenus" },
  { icon: UserPlus, label: "Inviter un utilisateur" },
];

const TODO = [
  { title: "Affiche Matchday — FC Fontainebleau vs US Varenne", meta: "Contenu à valider · Studio SportVision", action: "Valider", due: "Avant demain 12h" },
  { title: "Facture SV-2026-0418 — Août 2026", meta: "690,00 € TTC", action: "Payer", due: "Échue depuis 3 j" },
  { title: "Avenant Club+ Performance 2026-2027", meta: "Contrat à signer · Yousign", action: "Signer", due: "12 août" },
];

export function ClubPlusDashboard() {
  const { ctx } = useSession();
  const plan = PLANS[ctx.subscription.planCode];
  const creditsPct =
    plan.monthlyCredits && plan.monthlyCredits > 0
      ? Math.round((ctx.subscription.creditsRemaining / plan.monthlyCredits) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Aujourd&apos;hui</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            Bonjour {ctx.user.firstName}, voici ce qui nécessite votre attention.
          </h1>
        </div>
        <Button variant="dark">Demander une prestation</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <CardPremium>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">
                Votre offre
              </div>
              <div className="mt-1 text-[22px] font-extrabold tracking-tight">{plan.name}</div>
              <div className="mt-1 text-[12.5px] text-[#B9C7EB]">
                {formatPlanPrice(plan)} · renouvellement le {ctx.subscription.renewsAt}
              </div>
            </div>
            <Button variant="secondary" className="border-white/25 bg-white/[.12] text-white hover:border-white/40">
              Gérer l&apos;offre
            </Button>
          </div>
          <div className="relative mt-5 grid grid-cols-3 gap-3.5">
            <Gauge label="Crédits visuels" value={formatPlanCredits(plan)} pct={creditsPct} />
            <Gauge
              label="Présences terrain"
              value={`${ctx.subscription.presencesUsed} / ${plan.seasonPresences}`}
              pct={plan.seasonPresences ? (ctx.subscription.presencesUsed / plan.seasonPresences) * 100 : 0}
            />
            <Gauge
              label="Stockage"
              value={`${Math.round((ctx.subscription.storageUsedBytes / ctx.subscription.storageQuotaBytes) * 100)} %`}
              pct={(ctx.subscription.storageUsedBytes / ctx.subscription.storageQuotaBytes) * 100}
            />
          </div>
        </CardPremium>

        <Card className="p-4">
          <div className="text-[14px] font-extrabold tracking-tight">Actions rapides</div>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map(({ icon: Icon, label }) => (
              <button
                key={label}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface-alt px-2.5 py-2.5 text-left text-[12.5px] font-bold text-text-soft transition-transform duration-sv hover:-translate-y-px hover:border-brand-blue-pale"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                {label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[#F5A623]" />
            <span className="text-[15px] font-extrabold tracking-tight">À traiter</span>
            <Badge tone="warning">{TODO.length} éléments</Badge>
          </div>
          <button className="text-[12.5px] font-bold text-brand-blue-electric">Tout voir</button>
        </div>
        {TODO.map((t) => (
          <div
            key={t.title}
            className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-text">{t.title}</span>
              <span className="mt-0.5 block text-[12px] text-text-soft">{t.meta}</span>
            </span>
            <span className="w-28 flex-none text-right text-[12px] font-bold text-due-late">{t.due}</span>
            <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]">
              {t.action}
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Gauge({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-[#B9C7EB]">{label}</span>
        <span className="text-[13px] font-extrabold">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.16]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
