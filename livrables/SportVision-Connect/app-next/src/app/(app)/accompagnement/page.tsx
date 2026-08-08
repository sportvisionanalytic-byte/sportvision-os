"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { formatPlanCredits, PLANS } from "@/lib/plans";
import {
  accompagnementContacts,
  accompagnementInclusions,
  delegatedAccessByCmOrg,
  followUpPoints,
  monthlyFigures,
} from "@/lib/mock/persona";
import { LockedModule } from "@/components/persona/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /accompagnement — ACTIONS.md § 21. Deux variantes selon le type d'organisation : « Client »
// (4 cartes d'inclusions, interlocuteurs, suivi mensuel) pour tout le monde sauf le CM externe,
// qui voit à la place « Mes accès délégués » (une carte par club).
export default function AccompagnementPage() {
  const { ctx } = useSession();
  const router = useRouter();

  if (!canAccess(ctx, "accompagnement")) return <LockedModule ctx={ctx} />;

  if (ctx.organization.type === "cm_agency") {
    const accesses = delegatedAccessByCmOrg[ctx.organization.id] ?? [];
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Mes accès délégués</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
            Le périmètre que chaque club vous a délégué pour produire et publier en son nom.
          </p>
        </div>

        {accesses.length === 0 && (
          <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucun accès délégué pour le moment.</Card>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {accesses.map((access) => (
            <Card key={access.id} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[15px] font-extrabold tracking-tight">{access.clubName}</div>
                <Badge tone="info">Expire le {access.expiresAt}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[.05em] text-success-fg">
                    Autorisé
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-text-soft">
                    {access.allowed.map((a) => (
                      <li key={a}>· {a}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[.05em] text-danger-fg">
                    Non autorisé
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-text-soft">
                    {access.denied.map((d) => (
                      <li key={d}>· {d}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button variant="dark" className="mt-4 w-full" onClick={() => router.push("/communication")}>
                Ouvrir
              </Button>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Client classique — ACTIONS.md § 21 « Client ».
  const plan = PLANS[ctx.subscription.planCode];
  const storagePct = Math.round((ctx.subscription.storageUsedBytes / ctx.subscription.storageQuotaBytes) * 100);
  const inclusions = accompagnementInclusions(plan.name, formatPlanCredits(plan), plan.seasonPresences);
  // Contenus livrés ce mois-ci : donnée non modélisée ailleurs pour ces organisations, valeur
  // d'illustration réaliste — voir README.md § Fidélité.
  const figures = monthlyFigures(ctx.subscription.creditsRemaining, ctx.subscription.presencesUsed, 5, storagePct);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Votre accompagnement</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
            Ce que votre offre {plan.name} inclut, qui intervient pour vous, et le suivi du mois en cours.
          </p>
        </div>
        <Button variant="primary" onClick={() => router.push("/support")}>
          Parler à mon conseiller
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inclusions.map((inc) => (
          <Card key={inc.title} className="p-5">
            <div className="text-[14px] font-extrabold tracking-tight">{inc.title}</div>
            <div className="mt-1.5 text-[12.5px] text-text-soft">{inc.description}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="text-[15px] font-extrabold tracking-tight">Qui intervient pour vous</div>
        <div className="mt-3 flex flex-col gap-2.5">
          {accompagnementContacts.map((contact) => (
            <div
              key={contact.role}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3.5 py-2.5"
            >
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
                {initialsOf(contact.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-text">{contact.name}</span>
                <span className="block text-[11.5px] text-text-soft">{contact.role}</span>
              </span>
              <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]">
                Contacter
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-[15px] font-extrabold tracking-tight">Points de suivi mensuels</div>
        <div className="mt-3 flex flex-col gap-2">
          {followUpPoints.map((point) => (
            <div key={point.label} className="flex items-center gap-3 border-b border-divider py-2.5 last:border-0">
              <Badge tone={point.status === "done" ? "success" : "info"}>
                {point.status === "done" ? "Réalisé" : "Prévu"}
              </Badge>
              <span className="min-w-0 flex-1 text-[13px] font-semibold text-text">{point.label}</span>
              <span className="flex-none text-[12px] font-bold text-due">{point.date}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-[15px] font-extrabold tracking-tight">Le mois en cours</div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="rounded-xl border border-border bg-surface-alt p-3.5">
              <div className="text-[20px] font-extrabold tracking-tight">{f.value}</div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-text-soft">{f.label}</div>
            </div>
          ))}
        </div>
        <Button variant="secondary" className="mt-4" onClick={() => router.push("/billing")}>
          Gérer mon offre
        </Button>
      </Card>
    </div>
  );
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
