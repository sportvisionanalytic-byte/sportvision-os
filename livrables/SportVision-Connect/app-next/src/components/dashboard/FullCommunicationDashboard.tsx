"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Camera, FileBarChart, ListChecks, MessageCircle, MessageSquareText, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricCard } from "@/components/communication/MetricCard";
import { TransmitInfoModal } from "@/components/communication/TransmitInfoModal";
import { ToastViewport } from "@/components/communication/ToastViewport";
import { useToast } from "@/components/communication/useToast";
import { CONTENU_STATUT_LABEL, CONTENU_STATUT_TONE } from "@/components/communication/contenuStatusTone";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchContenus, type Contenu } from "@/lib/data/shared/contenus";
import {
  buildMonthlyReports,
  fetchContenuStatsByIds,
  formatReportPeriod,
  sumStat,
  type ContenuAvecStats,
  type MonthlyReport,
} from "@/lib/data/shared/contenu-stats";
import { fetchCommunityManager, type CommunityManager } from "@/lib/data/shared/community-manager";
import { fetchClubPresences, type ClubPresence } from "@/lib/data/club/presences";

// Tableau de bord Full Communication — ACTIONS.md § 5 « Full Communication ». Le titre varie par
// type d'organisation (voir heroContent), le contenu est identique pour tous.
//
// 11/08/2026 — jusqu'à cette nuit, cet écran lisait intégralement lib/mock/communication.ts (CM,
// publications, présences, rapports fictifs). Un bug de session.ts (buildClubActiveContext lisait
// `contrats` — fail-closed pour un club — au lieu de la vue `client_contrats`) empêchait tout vrai
// club Full Communication d'être détecté comme tel, donc ce dashboard n'avait jamais été vu par un
// client réel (corrigé commit 0be09cd). Reconstruit ici sur les mêmes sources `data/*` déjà
// réelles et vérifiées ailleurs dans l'app (/communication, /mycm, /reports, /analytics,
// /publications, /validations) — aucune logique nouvelle inventée, seulement réutilisée. Chaque
// section sans source réelle équivalente (disponibilité du CM, délai de réponse, prochain point,
// résumé narratif du rapport) est explicitement omise plutôt que fabriquée — voir le détail
// section par section ci-dessous.
export function FullCommunicationDashboard() {
  const { ctx } = useSession();
  const resolution = useClientId();
  const { toasts, showToast } = useToast();
  const [transmitOpen, setTransmitOpen] = useState(false);
  const { title, subtitle } = heroContent(ctx.organization);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="mt-1.5 max-w-2xl text-balance text-[29px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-text-soft">{subtitle}</p>}
        </div>
        <Button variant="primary" disabled={resolution.status !== "ready"} onClick={() => setTransmitOpen(true)}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          Transmettre une information
        </Button>
      </div>

      {resolution.status === "loading" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} className="h-[84px]" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-sv-card" />
        </div>
      )}

      {/* Non atteignable aujourd'hui en pratique (seul un club obtient le plan "full_communication",
          voir dashboard/page.tsx et session.ts:buildClubActiveContext) — gardé par défense en
          profondeur, honnête plutôt qu'un écran cassé si ça change un jour. */}
      {resolution.status === "locked" && (
        <Card>
          <EmptyState title="Aucune donnée réelle n'est disponible pour ce type d'espace pour le moment" />
        </Card>
      )}

      {resolution.status === "not_linked" && (
        <Card>
          <EmptyState
            icon={MessageSquareText}
            title="Communication pas encore reliée"
            description={`SportVision n'a pas encore relié ${ctx.organization.name} à un espace de communication. Contactez votre interlocuteur SportVision pour l'activer.`}
          />
        </Card>
      )}

      {resolution.status === "ready" && <DashboardBody clientId={resolution.clientId} />}

      {resolution.status === "ready" && (
        <TransmitInfoModal
          open={transmitOpen}
          onClose={() => setTransmitOpen(false)}
          clientId={resolution.clientId}
          onSubmitted={() => {
            setTransmitOpen(false);
            showToast("Information transmise à votre Community Manager.");
          }}
        />
      )}
      <ToastViewport toasts={toasts} />
    </div>
  );
}

function DashboardBody({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const router = useRouter();
  // "Présence" (module /presences) : réservé aux clubs, gated par un entitlement
  // organization_entitlements réel (voir data/club/presences.ts et permissions.ts) — jamais
  // affiché pour un espace qui n'a pas ce module sur son contrat.
  const canSeePresences = ctx.organization.type === "club" && canAccess(ctx, "presences");

  const [contenus, setContenus] = useState<Contenu[] | null>(null);
  const [monthlyReports, setMonthlyReports] = useState<MonthlyReport[]>([]);
  const [cm, setCm] = useState<CommunityManager | null>(null);
  const [presences, setPresences] = useState<ClubPresence[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setContenus(null);
    try {
      const supabase = createClient();
      const [items, cmProfile] = await Promise.all([
        fetchContenus(supabase, clientId),
        fetchCommunityManager(supabase, clientId),
      ]);
      setContenus(items);
      setCm(cmProfile);

      // "Dernier rapport" — même définition qu'/reports (contenus publiés groupés par mois de
      // date_publication, enrichis de leurs contenu_stats si saisies). fetchContenuStatsByIds
      // plutôt que fetchContenusPubliesAvecStats : évite un second appel fetchContenus, `items`
      // ci-dessus sert déjà de base.
      const publishedIds = items.filter((c) => c.statut === "publie").map((c) => c.id);
      const statsById = await fetchContenuStatsByIds(supabase, publishedIds);
      const withStats: ContenuAvecStats[] = items
        .filter((c) => c.statut === "publie")
        .map((c) => ({ ...c, stats: statsById.get(c.id) ?? null }));
      setMonthlyReports(buildMonthlyReports(withStats));

      if (canSeePresences) {
        setPresences(await fetchClubPresences(supabase, ctx.organization.id));
      }
    } catch {
      setLoadError(true);
      setContenus([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (loadError) {
    return (
      <Card>
        <ErrorState message="Impossible de charger votre communication." onRetry={reload} />
      </Card>
    );
  }

  if (contenus === null) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} className="h-[84px]" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-sv-card" />
      </div>
    );
  }

  const now = Date.now();
  const inSevenDays = now + 7 * 86_400_000;
  const effectiveDate = (c: Contenu) => new Date(c.datePrevue ?? c.datePublication ?? c.createdAt).getTime();

  // "Contenu à valider" / bandeau — file réelle de /validations (statut a_valider_client).
  const toValidate = contenus.filter((c) => c.statut === "a_valider_client");

  // "Publications programmées" — traduction du même concept que le mock ("actif dans les 7
  // prochains jours, hors annulé"), adaptée au vocabulaire réel de `contenus` : `archive` est
  // l'équivalent terminal réel de "cancelled"/"publish_error" (aucun de ces deux statuts n'existe
  // côté `contenus`).
  const scheduledThisWeek = contenus.filter((c) => {
    if (c.statut === "archive") return false;
    const t = effectiveDate(c);
    return t >= now - 86_400_000 && t <= inSevenDays;
  });

  // "Ce que nous préparons" — tout ce qui n'est pas encore publié ni archivé, trié par échéance la
  // plus proche. Lignes non cliquables (contrairement au mock) : la fiche détail
  // /communication/publications/[id] reste bâtie sur des identifiants mock et ne sait pas résoudre
  // un vrai id `contenus` — même choix que /analytics pour la même raison (voir son commentaire).
  const upcoming = contenus
    .filter((c) => c.statut !== "publie" && c.statut !== "archive")
    .sort((a, b) => effectiveDate(a) - effectiveDate(b))
    .slice(0, 4);

  const latestReport = monthlyReports[0];
  const latestReportReach = latestReport ? sumStat(latestReport.items, "portee") : null;
  const nextPresence = (presences ?? []).find((p) => p.status === "scheduled");

  return (
    <>
      {toValidate.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-blue/30 bg-info-bg px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/60 text-info-fg dark:bg-white/10">
              <ListChecks className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <div className="text-[14px] font-extrabold tracking-tight text-info-fg">
                {toValidate.length} contenu{toValidate.length > 1 ? "s" : ""} en attente de votre validation
              </div>
              <div className="text-[12.5px] font-semibold text-info-fg/80">Un œil rapide suffit, on s&apos;occupe du reste.</div>
            </div>
          </div>
          <Button variant="dark" onClick={() => router.push("/validations")}>
            Voir ce qui attend ma validation
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <MetricCard
          icon={Calendar}
          label="Publications programmées"
          value={String(scheduledThisWeek.length)}
          hint="Sur les 7 prochains jours"
        />
        <MetricCard icon={ListChecks} label="Contenu à valider" value={String(toValidate.length)} hint="File de validation" />
        <MetricCard
          icon={Camera}
          label="Présence"
          value={!canSeePresences ? "Non disponible" : nextPresence ? formatDateShort(nextPresence.date) : "Aucune prévue"}
          hint={
            !canSeePresences
              ? "Module non activé sur ce contrat"
              : (nextPresence?.eventLabel ?? "Aucune présence programmée")
          }
        />
        <MetricCard
          icon={FileBarChart}
          label="Rapport"
          value={latestReport ? formatReportPeriod(latestReport.period) : "À venir"}
          hint={latestReport ? "Disponible" : "Après votre première publication"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-divider px-5 py-4">
            <span className="text-[15px] font-extrabold tracking-tight">Ce que nous préparons</span>
            {/* -m-3/p-3 agrandit la zone tactile réelle sans changer la taille visuelle du lien
                — même correctif que ClubPlusDashboard, trouvé trop petit à l'audit mobile. */}
            <button
              onClick={() => router.push("/communication")}
              className="-m-3 p-3 text-[12.5px] font-bold text-brand-blue-electric"
            >
              Planning complet
            </button>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState title="Rien de programmé pour le moment" />
          ) : (
            upcoming.map((c) => {
              const date = c.datePrevue ?? c.datePublication;
              return (
                <div key={c.id} className="flex w-full items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-text">{c.titre}</span>
                    <span className="mt-0.5 block text-[12px] text-text-soft">
                      {[c.plateforme, c.typeContenu].filter(Boolean).join(" · ") || "—"}
                      {date && ` · ${formatDateShort(date)}`}
                    </span>
                  </span>
                  <Badge tone={CONTENU_STATUT_TONE[c.statut]}>{CONTENU_STATUT_LABEL[c.statut]}</Badge>
                </div>
              );
            })
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {/* Fiche CM — mêmes champs réels que /mycm (data/shared/community-manager.ts). Pas de
              badge de disponibilité ni de "délai de réponse" : aucune table réelle ne les porte
              (voir le commentaire de fetchContentsProducedThisMonth) — /mycm fait le même choix
              en affichant ces indicateurs "Non disponible" plutôt que de les fabriquer ici. */}
          {cm && (
            <CardPremium>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white/15 text-[13px] font-extrabold text-white">
                  {((cm.firstName[0] ?? "") + (cm.lastName[0] ?? "")).toUpperCase() || "CM"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-extrabold tracking-tight">
                    {`${cm.firstName} ${cm.lastName}`.trim() || "Community Manager"}
                  </div>
                  <div className="truncate text-[12px] text-[#B9C7EB]">{cm.levelLabel ?? "Community Manager SportVision"}</div>
                </div>
              </div>
              <Button
                variant="secondary"
                className="mt-4 w-full border-white/25 bg-white/[.12] text-white hover:border-white/40"
                onClick={() => router.push("/mycm")}
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                Voir ma fiche Community Manager
              </Button>
              <button
                onClick={() => router.push("/messages")}
                className="mt-2.5 w-full text-center text-[12px] font-bold text-brand-blue-pale hover:text-white"
              >
                Écrire à {cm.firstName || "votre Community Manager"}
              </button>
            </CardPremium>
          )}

          {latestReport && (
            <Card className="p-4">
              <div className="text-[13.5px] font-extrabold tracking-tight">Dernier rapport</div>
              <div className="mt-1 text-[12.5px] text-text-soft">
                {formatReportPeriod(latestReport.period)} — {latestReport.items.length} contenu
                {latestReport.items.length > 1 ? "s" : ""} publié{latestReport.items.length > 1 ? "s" : ""}
                {latestReportReach != null && ` · ${latestReportReach.toLocaleString("fr-FR")} portée (saisi manuellement)`}
              </div>
              <Button variant="secondary" className="mt-3.5 w-full" onClick={() => router.push("/reports")}>
                Lire le rapport
              </Button>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function heroContent(organization: { type: string; name: string }): { title: string; subtitle: string } {
  if (organization.type === "coach") {
    return {
      title: "Développez votre image professionnelle",
      subtitle: "Un aperçu de votre communication et de ce qui attend votre validation.",
    };
  }
  if (organization.type === "academy") {
    return {
      title: "Pilotez le calendrier de votre académie",
      subtitle: "Le calendrier éditorial et la production en cours, en un coup d'œil.",
    };
  }
  if (organization.type === "tournament_organizer" || organization.type === "camp") {
    // Le mock affichait un compte à rebours "J-N" calé sur une date d'événement fictive
    // (ELITE_CUP_EVENT_DATE, une constante du mock). Aucune table réelle ne porte de date
    // d'événement pour organizations.organization_type='tournoi'/'stage' à ce jour (bascule 2 org
    // types séparés, migration-clubplus-v44, 17/08/2026) — retiré plutôt qu'affiché sur une donnée
    // inventée. Chemin non atteignable en pratique aujourd'hui de toute façon : seul un club
    // obtient le plan "full_communication" (session.ts:buildClubActiveContext), un espace
    // tournoi/camp reste toujours en plan "one_off" (buildOrgSpaceActiveContext) et n'affiche donc
    // jamais ce dashboard pour l'instant.
    return {
      title: `${organization.name} — communication de l'événement`,
      subtitle: "Toute la communication de l'événement, du teasing au bilan.",
    };
  }
  return {
    title: `Bonjour, voici votre communication de la semaine.`,
    subtitle: `Ce qui est prévu pour ${organization.name} cette semaine.`,
  };
}

function formatDateShort(date: string): string {
  return new Date(date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}
