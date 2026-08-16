"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { formatPlanCredits, PLANS } from "@/lib/plans";
import type { ActiveContext } from "@/lib/types";
import { delegatedAccessByCmOrg } from "@/lib/mock/persona";
import { fetchConfirmedChildren, type ConfirmedChild } from "@/lib/data/family/children";
import { fetchChildAuthorizations, type ChildAuthorization } from "@/lib/data/family/authorizations";
import { fetchOrgRequests } from "@/lib/data/shared/requests";
import { fetchSponsorPartnerships } from "@/lib/data/sponsor/sponsorships";
import { fetchCoachPlayers } from "@/lib/data/coach/players";
import { fetchAcademieGroups } from "@/lib/data/academie/groups";
import { fetchClientInvoices } from "@/lib/data/projet/billing";
import { fetchClientServices } from "@/lib/data/projet/services";
import { fetchClientLivrables } from "@/lib/data/projet/livrables";
import type { Sponsor } from "@/lib/types/sponsors";
import type { Invoice } from "@/lib/types/billing";
import type { Service } from "@/lib/types/services";
import { SERVICE_TYPE_LABELS } from "@/lib/types/services";
import { MEDIA_KIND_LABELS, type MediaAsset } from "@/lib/types/content";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

function daysLate(dueDate: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24)));
}

function formatFrDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Tableau de bord — variante Persona. Couvre Joueur, Parent, Sponsor, CM externe, Client
// ponctuel, Structure générique, et Académie/Coach hors Full Communication (tout ce qui n'est
// ni club ni Full Communication — voir src/app/(app)/dashboard/page.tsx, l'aiguilleur).
// Voir ACTIONS.md § 5 « Joueur, Parent, CM externe, Client ponctuel » et § 20 bis (sponsor).
// Même ossature pour tous : bandeau héros contextuel, 3 jauges, liste prioritaire, liste
// secondaire, derniers contenus — seul le contenu varie selon `ctx.organization.type`, voir
// `buildConfig` ci-dessous. Copie les conventions de ClubPlusDashboard.tsx (référence de style).

interface PersonaGauge {
  label: string;
  value: string;
  pct: number | null;
}

interface PersonaListItem {
  title: string;
  meta: string;
  due?: string;
  action?: string;
  actionHref?: string;
}

interface PersonaContentItem {
  label: string;
  kind: string;
}

interface PersonaConfig {
  eyebrow: string;
  clubBadge?: { label: string; tone: BadgeTone };
  title: string;
  subtitle: string;
  heroActionLabel?: string;
  heroActionHref?: string;
  showShareBook?: boolean;
  gauges: PersonaGauge[];
  priorityTitle: string;
  priorityItems: PersonaListItem[];
  secondaryTitle: string;
  secondaryItems: PersonaListItem[];
  contentsTitle: string;
  contents: PersonaContentItem[];
}

/** Données réelles chargées côté PersonaDashboard pour le cas parent (voir le plan Phase 2
 * § Décisions d'architecture n°6) — vide tant que non chargées, buildConfig retombe alors sur des
 * valeurs à zéro plutôt que de bloquer le rendu du tableau de bord. "player" retiré le 11/08/2026,
 * voir PlayerDashboard.tsx. */
interface PersonaExtra {
  children?: ConfirmedChild[];
  authByChild?: Record<string, ChildAuthorization[]>;
  openRequestsCount?: number;
  partnerships?: Sponsor[];
  rosterCount?: number;
  genericOverdueInvoice?: Invoice;
  genericUpcomingService?: Service;
  genericContents?: MediaAsset[];
}

function hasValidImageRight(auths: ChildAuthorization[] | undefined): boolean {
  return !!auths?.some((a) => a.code === "droit_image" && a.statut === "valide");
}

function buildConfig(ctx: ActiveContext, extra: PersonaExtra, extraLoading: boolean): PersonaConfig {
  const { organization, user, subscription } = ctx;
  const plan = PLANS[subscription.planCode];
  const storagePct = Math.round((subscription.storageUsedBytes / subscription.storageQuotaBytes) * 100);
  const creditsPct =
    plan.monthlyCredits && plan.monthlyCredits > 0
      ? Math.round((subscription.creditsRemaining / plan.monthlyCredits) * 100)
      : 0;

  switch (organization.type) {
    // "player" retiré le 11/08/2026 : dashboard/page.tsx route désormais organization.type ===
    // "player" directement vers PlayerDashboard.tsx (composant dédié, même pattern que
    // ClubPlusDashboard/FullCommunicationDashboard) — voir PlayerDashboard.tsx pour le detail et
    // le brief Fouka. Ce switch ne reçoit donc plus jamais organization.type === "player" ; la
    // branche "SANS CLUB"/showShareBook ci-dessus n'a d'ailleurs jamais été atteignable pour un
    // vrai compte (player_profiles.club_id est NOT NULL en base, voir session.ts).

    case "parent": {
      const children = extra.children ?? [];
      const authByChild = extra.authByChild ?? {};
      const signedCount = children.filter((c) => hasValidImageRight(authByChild[c.playerId])).length;
      const authPct = children.length ? Math.round((signedCount / children.length) * 100) : 100;
      const pendingChild = children.find((c) => !hasValidImageRight(authByChild[c.playerId]));
      return {
        eyebrow: "Mes enfants",
        title: `Bonjour ${user.firstName}, voici le suivi de vos enfants.`,
        subtitle: "Profils, contenus et autorisations de vos enfants, réunis au même endroit.",
        heroActionLabel: "Gérer les autorisations",
        heroActionHref: "/authorizations",
        // Crédits/stockage retirés : pas de sens pour un espace parent (toujours 0 côté
        // session.ts, pas d'organization_entitlements hors club). Seule "Autorisations à jour"
        // est une donnée réellement suivie ici.
        gauges: [
          {
            label: "Autorisations à jour",
            value: extraLoading ? "Chargement…" : `${signedCount} / ${children.length}`,
            pct: extraLoading ? null : authPct,
          },
        ],
        priorityTitle: "À traiter",
        priorityItems: pendingChild
          ? [
              {
                title: `Autorisation droit à l'image — ${pendingChild.firstName} ${pendingChild.lastName}`,
                meta: "Signature requise · bloque la publication de ses contenus",
                action: "Signer",
                actionHref: "/authorizations",
                due: "Dès que possible",
              },
            ]
          : [],
        secondaryTitle: "Prochainement",
        secondaryItems: [
          { title: `Prochain match — ${children[0]?.firstName ?? "votre enfant"}`, meta: children[0]?.teamName ?? "", due: "Dimanche 17 août · 10h00" },
          { title: "Facture SportVision — Août", meta: "0,00 € · inclus dans l'offre du club" },
        ],
        contentsTitle: "Leurs derniers contenus",
        // Pas de club_id unique exposé par enfant ici (ConfirmedChild n'expose que clubName) —
        // pas de source réelle branchable sans requête supplémentaire par enfant, pas remplacé
        // par une autre fiction. Voir le plan Phase 1 § pas de fabrication de données.
        contents: [],
      };
    }

    case "sponsor": {
      // club_sponsors réel (Phase 4) — pas de deliverables/opérations trackées (voir
      // data/sponsor/sponsorships.ts), gauges recentrées sur ce qui est réellement su : nombre
      // de partenariats et montant total engagé.
      const partnerships = extra.partnerships ?? [];
      const totalAmount = partnerships.reduce((sum, s) => sum + s.annualAmount, 0);
      const activeCount = partnerships.filter((s) => s.status === "active").length;
      const clubNames = partnerships.map((s) => s.name).join(", ");
      return {
        eyebrow: "Mon partenariat",
        title: `Bonjour ${user.firstName}, voici votre partenariat${partnerships.length > 1 ? "s" : ""}${clubNames ? ` avec ${clubNames}` : ""}.`,
        subtitle: "Suivez vos partenariats et vos demandes auprès de SportVision.",
        heroActionLabel: "Voir mes partenariats",
        heroActionHref: "/sponsors",
        gauges: [
          { label: "Partenariats actifs", value: `${activeCount} / ${partnerships.length}`, pct: partnerships.length ? Math.round((activeCount / partnerships.length) * 100) : 0 },
          // Pas de barre de progression : "Montant engagé" est un total, pas un ratio suivi.
          { label: "Montant engagé", value: `${totalAmount.toLocaleString("fr-FR")} €`, pct: null },
          { label: "Stockage", value: `${storagePct} %`, pct: storagePct },
        ],
        priorityTitle: "À traiter",
        priorityItems:
          extra.openRequestsCount && extra.openRequestsCount > 0
            ? [{ title: `${extra.openRequestsCount} demande${extra.openRequestsCount > 1 ? "s" : ""} en attente`, meta: "Envoyées à SportVision", action: "Voir", actionHref: "/requests", due: undefined }]
            : [],
        secondaryTitle: "Mes partenariats",
        secondaryItems: partnerships.map((s) => ({ title: s.name, meta: `${s.annualAmount.toLocaleString("fr-FR")} € / an`, due: s.endsAt })),
        contentsTitle: "Contenus sponsorisés",
        contents: [],
      };
    }

    case "cm_agency": {
      const delegated = delegatedAccessByCmOrg[organization.id] ?? [];
      const soonExpiring = [...delegated].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
      return {
        eyebrow: "Studio",
        title: `Bonjour ${user.firstName}, voici vos clubs à accompagner.`,
        subtitle: "Produisez pour vos clubs délégués et suivez ce qui reste à valider.",
        heroActionLabel: "Produire pour mes clubs",
        heroActionHref: "/communication",
        gauges: [
          { label: "Accès délégués actifs", value: `${delegated.length}`, pct: delegated.length ? 100 : 0 },
          { label: "Crédits Studio", value: formatPlanCredits(plan), pct: creditsPct },
          { label: "Stockage", value: `${storagePct} %`, pct: storagePct },
        ],
        priorityTitle: "À traiter",
        priorityItems: [
          {
            title: "3 publications à valider — FC Fontainebleau",
            meta: "Planning éditorial",
            action: "Ouvrir",
            due: "Avant demain",
          },
        ],
        secondaryTitle: "Accès délégués",
        secondaryItems: soonExpiring
          ? [{ title: `Accès délégué — ${soonExpiring.clubName}`, meta: "Pensez au renouvellement", due: `Expire le ${soonExpiring.expiresAt}` }]
          : [],
        contentsTitle: "Dernières productions",
        contents: [
          { label: "Affiche Matchday", kind: "Photo" },
          { label: "Recap hebdomadaire", kind: "Vidéo" },
          { label: "Story sponsor", kind: "Story" },
        ],
      };
    }

    case "event": {
      const isOneOff = subscription.planCode === "one_off";
      return {
        eyebrow: "Mon événement",
        title: `Bonjour ${user.firstName}, voici le suivi de ${organization.name}.`,
        subtitle: isOneOff
          ? "Suivez votre prestation SportVision du début à la livraison."
          : "Préparez votre événement et suivez ce qui reste à faire.",
        heroActionLabel: isOneOff ? "Suivre ma prestation" : "Préparer l'événement",
        heroActionHref: "/services",
        // Crédits/présences/stockage n'ont pas de sens ici (toujours 0 côté session.ts).
        gauges: [],
        priorityTitle: "À traiter",
        priorityItems: [
          {
            title: "Contrat de prestation",
            meta: "À signer · Youtrust",
            action: "Signer",
            due: "12 août",
          },
        ],
        secondaryTitle: "Prochainement",
        secondaryItems: [{ title: "Prestation planifiée", meta: "Complexe sportif, Fontainebleau", due: "7 septembre 2026" }],
        contentsTitle: "Derniers contenus",
        contents: [
          { label: "Affiche de l'événement", kind: "Photo" },
          { label: "Teaser", kind: "Vidéo" },
        ],
      };
    }

    case "academy":
    case "coach": {
      // coach_players/academie_groups + requests génériques réels (Phase 4) — pas de
      // crédits/présences suivis pour ces espaces (pas d'organization_entitlements, voir
      // buildOrgSpaceActiveContext), une jauge crédits/présences n'aurait donc pas de sens ici.
      const isAcademy = organization.type === "academy";
      const rosterCount = extra.rosterCount ?? 0;
      const openRequests = extra.openRequestsCount ?? 0;
      return {
        eyebrow: isAcademy ? "Mon académie" : "Mon activité",
        title: `Bonjour ${user.firstName}, voici ce qui nécessite votre attention.`,
        subtitle: isAcademy
          ? "Suivez vos groupes et vos demandes auprès de SportVision."
          : "Suivez vos joueurs et vos demandes auprès de SportVision.",
        heroActionLabel: "Voir mes demandes",
        heroActionHref: "/requests",
        gauges: [
          { label: isAcademy ? "Groupes" : "Joueurs suivis", value: `${rosterCount}`, pct: rosterCount > 0 ? 100 : 0 },
          { label: "Demandes en attente", value: `${openRequests}`, pct: openRequests > 0 ? 100 : 0 },
          { label: "Stockage", value: `${storagePct} %`, pct: storagePct },
        ],
        priorityTitle: "À traiter",
        priorityItems:
          openRequests > 0
            ? [{ title: `${openRequests} demande${openRequests > 1 ? "s" : ""} en attente`, meta: "Envoyées à SportVision", action: "Voir", actionHref: "/requests" }]
            : [],
        secondaryTitle: isAcademy ? "Mes groupes" : "Mes joueurs suivis",
        secondaryItems: [],
        contentsTitle: "Derniers contenus",
        contents: [],
      };
    }

    case "generic":
    default: {
      // Espace Projet/ponctuel (ex-Portail) : devis/factures/prestations/livrables réels via les
      // vues client_* (data/projet/*), mêmes vues que /billing, /services et /content pour ce
      // type d'organisation — voir le plan Phase 3.
      const overdueInvoice = extra.genericOverdueInvoice;
      const upcomingService = extra.genericUpcomingService;
      const contents = extra.genericContents ?? [];
      return {
        eyebrow: "Aperçu",
        title: `Bonjour ${user.firstName}, voici ce qui nécessite votre attention.`,
        subtitle: "Vos prestations, vos contenus et vos factures, au même endroit.",
        heroActionLabel: "Commander une prestation",
        heroActionHref: "/services/new",
        gauges: [],
        priorityTitle: "À traiter",
        priorityItems: overdueInvoice
          ? [
              {
                title: `Facture ${overdueInvoice.number}`,
                meta: `${overdueInvoice.totalInclVat.toLocaleString("fr-FR")} € TTC`,
                action: "Payer",
                actionHref: "/billing",
                due: `Échue depuis ${daysLate(overdueInvoice.dueDate)} j`,
              },
            ]
          : [],
        secondaryTitle: "Prochainement",
        secondaryItems: upcomingService
          ? [
              {
                title: SERVICE_TYPE_LABELS[upcomingService.serviceType],
                meta: upcomingService.address || "",
                due: formatFrDate(upcomingService.date),
              },
            ]
          : [],
        contentsTitle: "Derniers contenus",
        contents: contents.slice(0, 4).map((c) => ({ label: c.name, kind: MEDIA_KIND_LABELS[c.kind] })),
      };
    }
  }
}

export function PersonaDashboard() {
  const { ctx } = useSession();
  const router = useRouter();
  const [shareCopied, setShareCopied] = useState(false);
  const [extra, setExtra] = useState<PersonaExtra>({});
  const [extraLoading, setExtraLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    setExtraLoading(true);
    // "player" retiré le 11/08/2026 : ce composant ne reçoit plus jamais organization.type ===
    // "player" (voir dashboard/page.tsx et PlayerDashboard.tsx).
    if (ctx.organization.type === "parent") {
      fetchConfirmedChildren(supabase, ctx.organization.id)
        .then(async (children) => {
          const entries = await Promise.all(
            children.map(async (c) => [c.playerId, await fetchChildAuthorizations(supabase, c.playerId)] as const),
          );
          setExtra({ children, authByChild: Object.fromEntries(entries) });
        })
        .catch(() => setExtra({}))
        .finally(() => setExtraLoading(false));
    } else if (ctx.organization.type === "sponsor") {
      Promise.all([
        fetchSponsorPartnerships(supabase, ctx.organization.id),
        fetchOrgRequests(supabase, ctx.organization.id),
      ])
        .then(([partnerships, requests]) => {
          setExtra({ partnerships, openRequestsCount: requests.filter((r) => r.status === "Envoyée").length });
        })
        .catch(() => setExtra({}))
        .finally(() => setExtraLoading(false));
    } else if (ctx.organization.type === "coach") {
      Promise.all([
        fetchCoachPlayers(supabase, ctx.organization.id),
        fetchOrgRequests(supabase, ctx.organization.id),
      ])
        .then(([players, requests]) => {
          setExtra({ rosterCount: players.length, openRequestsCount: requests.filter((r) => r.status === "Envoyée").length });
        })
        .catch(() => setExtra({}))
        .finally(() => setExtraLoading(false));
    } else if (ctx.organization.type === "academy") {
      Promise.all([
        fetchAcademieGroups(supabase, ctx.organization.id),
        fetchOrgRequests(supabase, ctx.organization.id),
      ])
        .then(([groups, requests]) => {
          setExtra({ rosterCount: groups.length, openRequestsCount: requests.filter((r) => r.status === "Envoyée").length });
        })
        .catch(() => setExtra({}))
        .finally(() => setExtraLoading(false));
    } else if (ctx.organization.type === "generic") {
      Promise.all([
        fetchClientInvoices(supabase, ctx.organization.id),
        fetchClientServices(supabase, ctx.organization.id),
        fetchClientLivrables(supabase, ctx.organization.id),
      ])
        .then(([invoices, services, livrables]) => {
          const now = Date.now();
          const upcomingService = services
            .filter((s) => s.date && new Date(s.date).getTime() >= now)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
          setExtra({
            genericOverdueInvoice: invoices.find((i) => i.status === "en_retard"),
            genericUpcomingService: upcomingService,
            genericContents: livrables,
          });
        })
        .catch(() => setExtra({}))
        .finally(() => setExtraLoading(false));
    } else {
      setExtra({});
      setExtraLoading(false);
    }
  }, [ctx.organization.id, ctx.organization.type, ctx.organization.parentOrganizationId]);

  const config = buildConfig(ctx, extra, extraLoading);

  function handleShareBook() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(`https://connect.sportvision-an.fr/book/${ctx.organization.id}`)
        .catch(() => undefined);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2200);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[12px] font-bold text-text-soft">{config.eyebrow}</span>
            {config.clubBadge && <Badge tone={config.clubBadge.tone}>{config.clubBadge.label}</Badge>}
          </div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">{config.title}</h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">{config.subtitle}</p>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          {config.showShareBook && (
            <Button variant="secondary" onClick={handleShareBook}>
              {shareCopied ? "Lien copié" : "Partager mon book"}
            </Button>
          )}
          {config.heroActionLabel && config.heroActionHref && (
            <Button variant="dark" onClick={() => router.push(config.heroActionHref!)}>
              {config.heroActionLabel}
            </Button>
          )}
        </div>
      </div>

      <CardPremium>
        <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">
          {/* coach/académie/sponsor n'ont jamais souscrit "Prestation unique" (planCode "one_off"
             posé en dur côté session.ts pour ces espaces, sans offre réellement vendue) : pas de
             nom d'offre inventé pour eux. */}
          {["coach", "academy", "sponsor"].includes(ctx.organization.type)
            ? "Espace professionnel"
            : PLANS[ctx.subscription.planCode].name}
        </div>
        {config.gauges.length > 0 && (
          <div className="relative mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {config.gauges.map((g) => (
              <Gauge key={g.label} {...g} />
            ))}
          </div>
        )}
      </CardPremium>

      <Card>
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[#F5A623]" />
            <span className="text-[15px] font-extrabold tracking-tight">{config.priorityTitle}</span>
            <Badge tone="warning">{config.priorityItems.length} élément{config.priorityItems.length > 1 ? "s" : ""}</Badge>
          </div>
        </div>
        {config.priorityItems.length === 0 &&
          (extraLoading ? (
            <div>
              {Array.from({ length: 2 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : (
            <EmptyState title="Rien à traiter pour le moment" description="Tout est à jour." />
          ))}
        {config.priorityItems.map((item) => (
          <div
            key={item.title}
            className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-text">{item.title}</span>
              <span className="mt-0.5 block text-[12px] text-text-soft">{item.meta}</span>
            </span>
            {item.due && (
              <span className="w-32 flex-none text-right text-[12px] font-bold text-due-warn">{item.due}</span>
            )}
            {item.action && (
              <Button
                variant="secondary"
                className="h-8 flex-none px-3 text-[12px]"
                onClick={item.actionHref ? () => router.push(item.actionHref!) : undefined}
              >
                {item.action}
              </Button>
            )}
          </div>
        ))}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <span className="text-[15px] font-extrabold tracking-tight">{config.secondaryTitle}</span>
        </div>
        {config.secondaryItems.length === 0 &&
          (extraLoading ? (
            <div>
              {Array.from({ length: 2 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : (
            <EmptyState title="Rien de prévu pour le moment" />
          ))}
        {config.secondaryItems.map((item) => (
          <div
            key={item.title}
            className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-text">{item.title}</span>
              {item.meta && <span className="mt-0.5 block text-[12px] text-text-soft">{item.meta}</span>}
            </span>
            {item.due && <span className="w-40 flex-none text-right text-[12px] font-bold text-due">{item.due}</span>}
          </div>
        ))}
      </Card>

      <div>
        <div className="mb-3 text-[15px] font-extrabold tracking-tight">{config.contentsTitle}</div>
        {config.contents.length === 0 && <EmptyState title="Rien à afficher pour le moment" className="p-0 py-4" />}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {config.contents.map((c) => (
            <div
              key={c.label}
              className="group relative aspect-square overflow-hidden rounded-sv-card border border-border transition-[transform,box-shadow,border-color] duration-sv hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover"
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "repeating-linear-gradient(125deg, rgba(79,125,255,.35) 0px, rgba(79,125,255,.35) 14px, rgba(168,85,247,.35) 14px, rgba(168,85,247,.35) 28px)",
                }}
              />
              <div className="absolute inset-0 flex items-end p-2.5">
                <span className="rounded-md bg-black/45 px-1.5 py-1 font-mono text-[10px] font-medium text-white">
                  {c.kind} · {c.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Gauge({ label, value, pct }: PersonaGauge) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-[#B9C7EB]">{label}</span>
        <span className="text-[13px] font-extrabold">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.16]">
        {pct !== null && (
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        )}
      </div>
    </div>
  );
}
