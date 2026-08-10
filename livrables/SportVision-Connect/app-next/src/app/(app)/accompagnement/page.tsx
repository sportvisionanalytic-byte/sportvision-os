"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { formatPlanCredits, PLANS } from "@/lib/plans";
import { accompagnementInclusions } from "@/lib/mock/persona";
import type { MonthlyFigure } from "@/lib/types/persona";
import type { ActiveContext } from "@/lib/types";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { fetchCommunityManager, type CommunityManager } from "@/lib/data/shared/community-manager";
import { fetchContenusPublishedThisMonth } from "@/lib/data/shared/contenus";
import { fetchClubPresencesThisMonth } from "@/lib/data/club/presences";
import { fetchDelegatedClubAccess, type DelegatedClubAccess } from "@/lib/data/shared/cm-agency-access";

// /accompagnement — ACTIONS.md § 21. Deux variantes selon le type d'organisation : « Client »
// (4 cartes d'inclusions, interlocuteurs, suivi mensuel, mois en cours) pour tout le monde sauf le
// CM externe, qui voit à la place « Mes accès délégués » (une carte par club).
//
// Branché sur de vraies données le 10/08/2026 (Tier C Phase 3 du plan). Périmètre réel : seuls
// club (offre Club+, hors Essentiel/Full Communication — voir navigation.ts NAV_CLUB_PLUS, Full
// Communication a /mycm à la place) et cm_agency ont ce module dans leur navigation ; les autres
// types d'organisation (coach/académie/sponsor/event/projet) peuvent en théorie l'atteindre par
// URL directe (canAccess ne filtre pas par type) — la page reste honnête pour eux plutôt que de
// planter : inclusions/plan toujours affichées (catalogue PLANS, réel pour tous), le reste
// « Non disponible » quand aucune source réelle n'existe pour ce type.
//
// Détail réel vs honnêtement absent des « 4 chiffres du mois » (aucun chiffre inventé) :
// - Crédits restants : réel uniquement pour un club (clubs.credits_balance - credits_reserved,
//   déjà résolu dans ActiveContext.subscription par session.ts). Pour tout autre type,
//   creditsRemaining est câblé à 0 en dur côté session.ts (jamais tracké) — afficher ce 0 serait
//   trompeur (laisse croire à un quota épuisé plutôt qu'à une absence de suivi) → « Non disponible ».
// - Présences réalisées : ActiveContext.subscription.presencesUsed est TOUJOURS 0 en dur, pour
//   tous les types y compris club (voir le commentaire equivalent dans /presences) — jamais
//   utilisé ici. À la place, vrai comptage sur `club_presences` (status='completed', mois en
//   cours) via fetchClubPresencesThisMonth, disponible uniquement pour un club (seul type couvert
//   par cette table, migration-connect-v17-club-presences.sql).
// - Contenus livrés : vrai comptage sur `contenus` (statut='publie', mois en cours) via
//   fetchContenusPublishedThisMonth, disponible dès que useClientId() résout un client_id (club
//   relié via portail_client_id, ou espace Projet générique) — « Non disponible » sinon
//   (coach/académie/sponsor/event : useClientId() ne résout rien pour eux à ce jour ; club non
//   relié : « pas encore relié »).
// - Stockage utilisé : storageUsedBytes/storageQuotaBytes sont câblés à 0/1 en dur pour TOUS les
//   types dans session.ts (aucune mesure de stockage réelle n'existe nulle part dans le code) →
//   toujours « Non disponible ».
//
// « Qui intervient pour vous » : le chargé de compte est le Community Manager assigné
// (clients.cm_id, vue client_cm, réutilise data/shared/community-manager.ts comme /mycm) — même
// portée que ci-dessus (useClientId()). « Studio SportVision » reste une entrée statique : ce
// n'est pas une donnée personnalisée par client, juste la description d'un service SportVision
// réel, vrai pour n'importe quel client.
//
// « Points de suivi mensuels » : supprimé du mock (dates fixes fictives, ACTIONS.md § 21) —
// aucune table ne trace un cycle de suivi mensuel CM↔client (même constat déjà posé pour /mycm
// « prochain point programmé » : `rendez_vous` est un système staff-géré distinct pour l'Espace
// Projet, pas une prise de RDV CM↔client). La section reste visible mais affiche cette absence
// honnêtement plutôt qu'un calendrier inventé.
export default function AccompagnementPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "accompagnement")) return <LockedModule />;
  if (ctx.organization.type === "cm_agency") {
    return <CmAgencyDelegatedAccess organizationId={ctx.organization.id} />;
  }
  return <ClientAccompagnement ctx={ctx} />;
}

// ─── CM externe — « Mes accès délégués » ────────────────────────────────────────────────────

type DelegatedAccessState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; accesses: DelegatedClubAccess[] };

function CmAgencyDelegatedAccess({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<DelegatedAccessState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const supabase = createClient();
    fetchDelegatedClubAccess(supabase, organizationId)
      .then((accesses) => {
        if (!cancelled) setState({ status: "ready", accesses });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Mes accès délégués</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          Le périmètre que chaque club vous a délégué pour produire et publier en son nom.
        </p>
      </div>

      {state.status === "loading" && (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      )}

      {state.status === "error" && (
        <Card className="p-8 text-center text-[13.5px] text-danger-fg">
          Impossible de charger vos accès délégués. Réessayez plus tard.
        </Card>
      )}

      {state.status === "ready" && state.accesses.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucun accès délégué pour le moment.</Card>
      )}

      {state.status === "ready" && state.accesses.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {state.accesses.map((access) => (
            <Card key={access.id} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[15px] font-extrabold tracking-tight">{access.clubName}</div>
                <Badge tone="info">{access.expiresAt ? `Expire le ${formatFrDate(access.expiresAt)}` : "Sans expiration"}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[.05em] text-success-fg">
                    Autorisé
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-text-soft">
                    {access.allowed.length ? access.allowed.map((a) => <li key={a}>· {a}</li>) : <li>—</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[.05em] text-danger-fg">
                    Non autorisé
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-text-soft">
                    {access.denied.length ? access.denied.map((d) => <li key={d}>· {d}</li>) : <li>—</li>}
                  </ul>
                </div>
              </div>
              <Button variant="dark" className="mt-4 w-full" onClick={() => router.push("/communication")}>
                Ouvrir
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Client classique (club/projet/coach/académie/sponsor/event) ───────────────────────────────

type CmState =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "not_linked" }
  | { status: "error" }
  | { status: "none" }
  | { status: "ready"; cm: CommunityManager };

function ClientAccompagnement({ ctx }: { ctx: ActiveContext }) {
  const router = useRouter();
  const plan = PLANS[ctx.subscription.planCode];
  const inclusions = accompagnementInclusions(plan.name, formatPlanCredits(plan), plan.seasonPresences);

  const resolution = useClientId();
  const [cmState, setCmState] = useState<CmState>({ status: "loading" });
  const [contentsThisMonth, setContentsThisMonth] = useState<number | null>(null);

  const [presencesThisMonth, setPresencesThisMonth] = useState<number | null>(null);
  const [presencesLoading, setPresencesLoading] = useState(ctx.organization.type === "club");

  // Chargé de compte + contenus livrés ce mois : les deux dépendent du même client_id Portail.
  useEffect(() => {
    let cancelled = false;
    if (resolution.status === "loading") return () => { cancelled = true; };
    if (resolution.status === "locked") {
      setCmState({ status: "locked" });
      setContentsThisMonth(null);
      return () => { cancelled = true; };
    }
    if (resolution.status === "not_linked") {
      setCmState({ status: "not_linked" });
      setContentsThisMonth(null);
      return () => { cancelled = true; };
    }
    const clientId = resolution.clientId;
    setCmState({ status: "loading" });
    const supabase = createClient();
    (async () => {
      const [cm, contents] = await Promise.all([
        fetchCommunityManager(supabase, clientId),
        fetchContenusPublishedThisMonth(supabase, clientId),
      ]);
      if (cancelled) return;
      setCmState(cm ? { status: "ready", cm } : { status: "none" });
      setContentsThisMonth(contents);
    })().catch(() => {
      if (!cancelled) setCmState({ status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [resolution]);

  // Présences réalisées ce mois : uniquement pour un club, indépendant du client_id Portail
  // (club_presences est indexée sur organization_id directement).
  useEffect(() => {
    if (ctx.organization.type !== "club") {
      setPresencesLoading(false);
      return;
    }
    let cancelled = false;
    setPresencesLoading(true);
    const supabase = createClient();
    fetchClubPresencesThisMonth(supabase, ctx.organization.id)
      .then((n) => {
        if (!cancelled) setPresencesThisMonth(n);
      })
      .catch(() => {
        if (!cancelled) setPresencesThisMonth(null);
      })
      .finally(() => {
        if (!cancelled) setPresencesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id, ctx.organization.type]);

  const creditsFigure: MonthlyFigure =
    ctx.organization.type === "club"
      ? { label: "Crédits restants", value: String(ctx.subscription.creditsRemaining) }
      : { label: "Crédits restants", value: "Non disponible" };

  const presencesFigure: MonthlyFigure =
    ctx.organization.type !== "club"
      ? { label: "Présences réalisées", value: "Non disponible" }
      : { label: "Présences réalisées", value: presencesLoading ? "…" : String(presencesThisMonth ?? 0) };

  const contentsFigure: MonthlyFigure =
    cmState.status === "loading"
      ? { label: "Contenus livrés", value: "…" }
      : cmState.status === "ready" || cmState.status === "none"
        ? { label: "Contenus livrés", value: String(contentsThisMonth ?? 0) }
        : { label: "Contenus livrés", value: "Non disponible" };

  const storageFigure: MonthlyFigure = { label: "Stockage utilisé", value: "Non disponible" };

  const figures: MonthlyFigure[] = [creditsFigure, presencesFigure, contentsFigure, storageFigure];

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
          <ContactRow name="Studio SportVision" role="Studio" onContact={() => router.push("/messages")} />
          {cmState.status === "loading" && <ContactRow name="Chargement…" role="Community Manager" />}
          {cmState.status === "ready" && (
            <ContactRow
              name={`${cmState.cm.firstName} ${cmState.cm.lastName}`.trim() || "Community Manager"}
              role={cmState.cm.levelLabel ?? "Community Manager SportVision"}
              onContact={() => router.push("/messages")}
            />
          )}
          {cmState.status !== "loading" && cmState.status !== "ready" && (
            <div className="rounded-xl border border-dashed border-border px-3.5 py-2.5 text-[12.5px] text-text-soft">
              {cmState.status === "not_linked" &&
                `SportVision n'a pas encore relié ${ctx.organization.name} à un espace CM.`}
              {cmState.status === "locked" &&
                "Le suivi du Community Manager n'est pas encore disponible pour ce type d'espace."}
              {cmState.status === "error" && "Impossible de charger votre Community Manager pour le moment."}
              {cmState.status === "none" && "Aucun Community Manager n'est encore assigné à cet espace."}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-[15px] font-extrabold tracking-tight">Points de suivi mensuels</div>
        <div className="mt-3 rounded-xl border border-dashed border-border px-3.5 py-3 text-[12.5px] text-text-soft">
          Aucun suivi mensuel n&apos;est encore tracé automatiquement ici. Pour un point d&apos;étape, utilisez
          « Parler à mon conseiller ».
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-[15px] font-extrabold tracking-tight">Le mois en cours</div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="rounded-xl border border-border bg-surface-alt p-3.5">
              <div className={`font-extrabold tracking-tight ${f.value.length > 5 ? "text-[14px]" : "text-[20px]"}`}>
                {f.value}
              </div>
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

function ContactRow({ name, role, onContact }: { name: string; role: string; onContact?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3.5 py-2.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
        {initialsOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-text">{name}</span>
        <span className="block text-[11.5px] text-text-soft">{role}</span>
      </span>
      {onContact && (
        <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={onContact}>
          Contacter
        </Button>
      )}
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

function formatFrDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
