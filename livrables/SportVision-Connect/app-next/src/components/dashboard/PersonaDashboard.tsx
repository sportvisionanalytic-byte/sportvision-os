"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { formatPlanCredits, PLANS } from "@/lib/plans";
import type { ActiveContext } from "@/lib/types";
import {
  delegatedAccessByCmOrg,
  sponsorDeliverables,
  sponsorOperationsByOrg,
} from "@/lib/mock/persona";
import { fetchConfirmedChildren, type ConfirmedChild } from "@/lib/data/family/children";
import { fetchChildAuthorizations, type ChildAuthorization } from "@/lib/data/family/authorizations";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

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
  pct: number;
}

interface PersonaListItem {
  title: string;
  meta: string;
  due?: string;
  action?: string;
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

/** Club sponsorisé affiché en en-tête du tableau de bord sponsor — donnée mock, pas un lien de
 * données réel (le sponsor n'a pas de `parentOrganizationId`, réservé au joueur affilié). */
const SPONSORED_CLUB_LABEL: Record<string, string> = {
  "org-varenneauto": "US Varenne",
};

/** Données réelles chargées côté PersonaDashboard pour les cas player/parent (voir le plan
 * Phase 2 § Décisions d'architecture n°6) — vide tant que non chargées, buildConfig retombe alors
 * sur des valeurs à zéro plutôt que de bloquer le rendu du tableau de bord. */
interface PersonaExtra {
  playerClubName?: string;
  children?: ConfirmedChild[];
  authByChild?: Record<string, ChildAuthorization[]>;
}

function hasValidImageRight(auths: ChildAuthorization[] | undefined): boolean {
  return !!auths?.some((a) => a.code === "droit_image" && a.statut === "valide");
}

function buildConfig(ctx: ActiveContext, extra: PersonaExtra): PersonaConfig {
  const { organization, user, subscription } = ctx;
  const plan = PLANS[subscription.planCode];
  const storagePct = Math.round((subscription.storageUsedBytes / subscription.storageQuotaBytes) * 100);
  const creditsPct =
    plan.monthlyCredits && plan.monthlyCredits > 0
      ? Math.round((subscription.creditsRemaining / plan.monthlyCredits) * 100)
      : 0;
  const presencesPct = plan.seasonPresences
    ? Math.round((subscription.presencesUsed / plan.seasonPresences) * 100)
    : 0;

  const standardGauges: PersonaGauge[] = [
    { label: "Crédits visuels", value: formatPlanCredits(plan), pct: creditsPct },
    {
      label: "Présences terrain",
      value: `${subscription.presencesUsed} / ${plan.seasonPresences}`,
      pct: presencesPct,
    },
    { label: "Stockage", value: `${storagePct} %`, pct: storagePct },
  ];

  switch (organization.type) {
    case "player": {
      const isAffiliated = !!organization.parentOrganizationId;
      return {
        eyebrow: "Mon espace",
        clubBadge: isAffiliated
          ? { label: `CLUB ABONNÉ · ${extra.playerClubName ?? "…"}`, tone: "success" }
          : { label: "SANS CLUB", tone: "neutral" },
        title: `Bonjour ${user.firstName}, voici vos derniers contenus.`,
        subtitle: isAffiliated
          ? "Vos contenus sont produits et validés par votre club. Retrouvez-les ici dès qu'ils sont prêts."
          : "Gérez vos prestations et partagez votre book à vos clubs et recruteurs.",
        heroActionLabel: isAffiliated ? "Consulter mes contenus" : "Réserver une prestation",
        heroActionHref: isAffiliated ? "/content" : "/services/new",
        showShareBook: !isAffiliated,
        gauges: standardGauges,
        priorityTitle: "À traiter",
        priorityItems: isAffiliated
          ? [
              {
                title: "Portrait officiel — saison 2026/2027",
                meta: "Contenu à valider · Studio SportVision",
                action: "Valider",
                due: "Avant le 14 août",
              },
            ]
          : [
              {
                title: "Devis — shooting individuel",
                meta: "En attente de votre validation",
                action: "Voir le devis",
                due: "Envoyé le 6 août",
              },
            ],
        secondaryTitle: "Prochainement",
        secondaryItems: isAffiliated
          ? [
              { title: "FC Fontainebleau vs US Varenne", meta: "Match à domicile", due: "Samedi 16 août · 15h00" },
              { title: "Séance photo individuelle", meta: "Studio SportVision", due: "20 août" },
            ]
          : [{ title: "Aucune prestation planifiée", meta: "Réservez votre premier shooting avec SportVision" }],
        contentsTitle: "Mes derniers contenus",
        contents: [
          { label: "Portrait officiel", kind: "Photo" },
          { label: "Temps fort — but", kind: "Vidéo" },
          { label: "Story victoire", kind: "Story" },
          { label: "Interview d'après-match", kind: "Vidéo" },
        ],
      };
    }

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
        gauges: [
          { label: "Autorisations à jour", value: `${signedCount} / ${children.length}`, pct: authPct },
          { label: "Crédits prestations", value: formatPlanCredits(plan), pct: creditsPct },
          { label: "Stockage", value: `${storagePct} %`, pct: storagePct },
        ],
        priorityTitle: "À traiter",
        priorityItems: pendingChild
          ? [
              {
                title: `Autorisation droit à l'image — ${pendingChild.firstName} ${pendingChild.lastName}`,
                meta: "Signature requise · bloque la publication de ses contenus",
                action: "Signer",
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
        contents: [
          { label: "Match du week-end", kind: "Photo" },
          { label: "Séance d'entraînement", kind: "Photo" },
          { label: "Temps fort", kind: "Vidéo" },
          { label: "Portrait d'équipe", kind: "Photo" },
        ],
      };
    }

    case "sponsor": {
      const deliverable = sponsorDeliverables[organization.id] ?? { delivered: 0, planned: 1 };
      const visibilityPct = Math.round((deliverable.delivered / deliverable.planned) * 100);
      const ops = sponsorOperationsByOrg[organization.id] ?? [];
      const completedOps = ops.filter((o) => o.status === "completed").length;
      const opsPct = ops.length ? Math.round((completedOps / ops.length) * 100) : 0;
      const nextOp = ops.find((o) => o.status === "planned");
      return {
        eyebrow: "Mon partenariat",
        title: `Bonjour ${user.firstName}, voici votre visibilité chez ${SPONSORED_CLUB_LABEL[organization.id] ?? "votre club partenaire"}.`,
        subtitle: "Suivez vos livrables, vos opérations et vos publications sponsorisées.",
        heroActionLabel: "Voir ma visibilité",
        heroActionHref: "/sponsors",
        gauges: [
          { label: "Jauge de visibilité", value: `${deliverable.delivered} / ${deliverable.planned}`, pct: visibilityPct },
          { label: "Opérations réalisées", value: `${completedOps} / ${ops.length}`, pct: opsPct },
          { label: "Stockage", value: `${storagePct} %`, pct: storagePct },
        ],
        priorityTitle: "À traiter",
        priorityItems: nextOp
          ? [{ title: nextOp.label, meta: "Opération à venir", action: "Voir", due: nextOp.date }]
          : [],
        secondaryTitle: "Vos livrables",
        secondaryItems: ops
          .filter((o) => o.status === "completed")
          .map((o) => ({ title: o.label, meta: "Livré", due: o.date })),
        contentsTitle: "Contenus sponsorisés",
        contents: [
          { label: "Bâche bord de terrain", kind: "Photo" },
          { label: "Maillot extérieur", kind: "Photo" },
          { label: "Story partenaire", kind: "Story" },
        ],
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
        gauges: standardGauges,
        priorityTitle: "À traiter",
        priorityItems: [
          {
            title: "Contrat de prestation",
            meta: "À signer · Yousign",
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
      const isAcademy = organization.type === "academy";
      return {
        eyebrow: isAcademy ? "Mon académie" : "Mon activité",
        title: `Bonjour ${user.firstName}, voici ce qui nécessite votre attention.`,
        subtitle: isAcademy
          ? "Suivez vos prestations et vos contenus produits pour l'académie."
          : "Commandez des contenus et suivez votre image professionnelle.",
        heroActionLabel: isAcademy ? "Suivre une prestation" : "Commander des contenus",
        heroActionHref: isAcademy ? "/services" : "/requests",
        gauges: standardGauges,
        priorityTitle: "À traiter",
        priorityItems: [
          {
            title: isAcademy ? "Devis — journée portes ouvertes" : "Demande de contenus — présentation programme",
            meta: isAcademy ? "Devis disponible · reçu le 5 août" : "En cours de création · Studio SportVision",
            action: isAcademy ? "Voir le devis" : "Suivre",
            due: isAcademy ? "À valider" : "Livraison sous 48 h",
          },
        ],
        secondaryTitle: "Prochainement",
        secondaryItems: [
          {
            title: isAcademy ? "Stage d'automne" : "Séance individuelle",
            meta: isAcademy ? "Centre sportif régional" : "Prochain rendez-vous",
            due: isAcademy ? "19 octobre 2026" : "14 août",
          },
        ],
        contentsTitle: "Derniers contenus",
        contents: [
          { label: "Affiche du programme", kind: "Photo" },
          { label: "Séance filmée", kind: "Vidéo" },
        ],
      };
    }

    case "generic":
    default: {
      return {
        eyebrow: "Aperçu",
        title: `Bonjour ${user.firstName}, voici ce qui nécessite votre attention.`,
        subtitle: "Vos prestations, vos contenus et vos factures, au même endroit.",
        heroActionLabel: "Commander une prestation",
        heroActionHref: "/services/new",
        gauges: standardGauges,
        priorityTitle: "À traiter",
        priorityItems: [
          { title: "Facture SV-2026-0512", meta: "312,00 € TTC", action: "Payer", due: "Échue depuis 2 j" },
        ],
        secondaryTitle: "Prochainement",
        secondaryItems: [{ title: "Prestation planifiée", meta: "Finale régionale", due: "22 août 2026" }],
        contentsTitle: "Derniers contenus",
        contents: [
          { label: "Affiche événement", kind: "Photo" },
          { label: "Reportage", kind: "Vidéo" },
        ],
      };
    }
  }
}

export function PersonaDashboard() {
  const { ctx } = useSession();
  const router = useRouter();
  const [shareCopied, setShareCopied] = useState(false);
  const [extra, setExtra] = useState<PersonaExtra>({});

  useEffect(() => {
    const supabase = createClient();
    if (ctx.organization.type === "player" && ctx.organization.parentOrganizationId) {
      supabase
        .from("organizations")
        .select("nom")
        .eq("id", ctx.organization.parentOrganizationId)
        .maybeSingle()
        .then(({ data }) => setExtra({ playerClubName: (data as { nom: string } | null)?.nom }));
    } else if (ctx.organization.type === "parent") {
      fetchConfirmedChildren(supabase, ctx.organization.id).then(async (children) => {
        const entries = await Promise.all(
          children.map(async (c) => [c.playerId, await fetchChildAuthorizations(supabase, c.playerId)] as const),
        );
        setExtra({ children, authByChild: Object.fromEntries(entries) });
      });
    } else {
      setExtra({});
    }
  }, [ctx.organization.id, ctx.organization.type, ctx.organization.parentOrganizationId]);

  const config = buildConfig(ctx, extra);

  function handleShareBook() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(`https://connect.sportvision.fr/book/${ctx.organization.id}`)
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
          {PLANS[ctx.subscription.planCode].name}
        </div>
        <div className="relative mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {config.gauges.map((g) => (
            <Gauge key={g.label} {...g} />
          ))}
        </div>
      </CardPremium>

      <Card>
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[#F5A623]" />
            <span className="text-[15px] font-extrabold tracking-tight">{config.priorityTitle}</span>
            <Badge tone="warning">{config.priorityItems.length} élément{config.priorityItems.length > 1 ? "s" : ""}</Badge>
          </div>
        </div>
        {config.priorityItems.length === 0 && (
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">
            Rien à traiter pour le moment. Tout est à jour.
          </div>
        )}
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
              <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]">
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
        {config.secondaryItems.length === 0 && (
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">Rien de prévu pour le moment.</div>
        )}
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
                    "repeating-linear-gradient(125deg, rgba(36,84,255,.35) 0px, rgba(36,84,255,.35) 14px, rgba(131,45,255,.35) 14px, rgba(131,45,255,.35) 28px)",
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
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
