"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Calendar, Images, ShieldCheck, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { filterClubRoleNav, resolveNavigation } from "@/lib/navigation";
import type { ModuleKey } from "@/lib/types";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { createClient } from "@/lib/supabase/client";
import { fetchClubMatches, fetchClubRequiresResultVerification } from "@/lib/data/club/matches";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

interface TodoItem {
  title: string;
  meta: string;
  action: string;
  due?: string;
}

// Tableau de bord — variante Club+ (Essentiel / Club+ Start / Club+ Performance, type club).
// Voir ACTIONS.md § 5 et DATA_MODEL.md pour les quotas. Écran de référence pour les
// conventions du scaffold ; copiez ses patterns pour les autres variantes de dashboard
// (src/components/dashboard/) plutôt que d'en inventer de nouveaux.

interface QuickAction {
  icon: LucideIcon;
  label: string;
  href: string;
  /** Module dont la présence dans la navigation du rôle actif conditionne l'affichage — voir
   * `roleNavModules`/`quickActions` dans le composant. Remplace l'ancien filtre ad hoc
   * (isClubCommunicationOrEducateur, qui ne connaissait que 2 des 9 rôles club réels) : la
   * navigation par rôle (navigation.ts § filterClubRoleNav, fondations "Autres rôles Club+" du
   * 17/08/2026) est désormais la source de vérité unique pour "qu'est-ce que ce rôle utilise",
   * pas une deuxième liste à maintenir ici. */
  module: ModuleKey;
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: Sparkles, label: "Demander un visuel", href: "/studio", module: "studio" },
  { icon: Calendar, label: "Ajouter un événement", href: "/calendar", module: "calendar" },
  { icon: Images, label: "Consulter les contenus", href: "/content", module: "content" },
  { icon: UserPlus, label: "Inviter un utilisateur", href: "/users", module: "users" },
];

export function ClubPlusDashboard() {
  const { ctx } = useSession();
  const router = useRouter();

  // Actions rapides visibles pour ce rôle = modules réellement présents dans SA navigation
  // (navigation.ts § filterClubRoleNav, fondations "Autres rôles Club+" du 17/08/2026), pas une
  // deuxième liste de rôles à maintenir en parallèle ici. Remplace l'ancien filtre ad hoc
  // (isClubCommunicationOrEducateur) qui ne connaissait que 2 des 9 rôles club réels — un
  // trésorier ou un secrétaire, par exemple, voyaient auparavant "Demander un visuel"/"Consulter
  // les contenus" alors que ces modules n'apparaissent nulle part dans leur propre menu.
  const roleNavModules = new Set(
    filterClubRoleNav(
      resolveNavigation(ctx.organization.type, ctx.subscription.planCode),
      ctx.membership.role,
      ctx.membership.teamScope,
    )
      .filter((e) => e.kind === "item")
      .map((e) => (e.kind === "item" ? e.module : undefined)),
  );
  const quickActions = QUICK_ACTIONS.filter((a) => roleNavModules.has(a.module));

  const plan = PLANS[ctx.subscription.planCode];
  const creditsPct =
    plan.monthlyCredits && plan.monthlyCredits > 0
      ? Math.round((ctx.subscription.creditsRemaining / plan.monthlyCredits) * 100)
      : 0;

  // "À traiter" — auparavant 3 lignes fictives (FC Fontainebleau...) affichées sur tout compte
  // club réel, trouvé lors de la première vérification en conditions réelles (08/08/2026).
  // Seules les créations SportVision au statut 'a_valider' comptent — 'brouillon' partage le même
  // statut mappé côté fetchClubMediaAssets (voir data/club/content.ts CREATION_STATUS_MAP), donc
  // requête directe ici sur le statut brut plutôt que via ce mapping. Factures/contrats restent
  // hors scope (voir le plan Phase 1 § Gaps de données), pas remplacés par une autre fiction.
  //
  // Trésorier (Bible §10 : "Aucun contenu sportif parasite") : ce bloc ne montre que du contenu
  // Studio (visuels/médias), jamais pertinent pour ce rôle — masqué, pas vidé silencieusement.
  const isTreasurer = ctx.membership.role === "treasurer";
  const [todo, setTodo] = useState<TodoItem[] | null>(null);
  const [error, setError] = useState(false);

  const loadTodo = useCallback(async () => {
    if (isTreasurer) return;
    const supabase = createClient();
    setError(false);
    try {
      const { data, error: queryError } = await supabase
        .from("club_creations")
        .select("id, title, created_at")
        .eq("club_id", ctx.organization.id)
        .eq("status", "a_valider")
        .order("created_at", { ascending: false });
      if (queryError) {
        setError(true);
        return;
      }
      setTodo(
        ((data ?? []) as { id: string; title: string }[]).map((row) => ({
          title: row.title,
          meta: "Contenu à valider · Studio SportVision",
          action: "Valider",
        })),
      );
    } catch {
      setError(true);
    }
  }, [ctx.organization.id, isTreasurer]);

  useEffect(() => {
    loadTodo();
  }, [loadTodo]);

  // Résultat(s) à traiter — Bible §7 : "prioritaire lorsqu'un match est terminé" pour le Coach ;
  // Bible §8 : "Résultats à vérifier" pour le Directeur sportif, couche intermédiaire qui confirme
  // ce que le coach a déjà saisi une seule fois. team_id est désormais réellement assignable
  // (matchcenter/page.tsx § canAssignTeam, 17/08/2026) mais reste NULL sur beaucoup de matchs tant
  // qu'un Admin/Directeur sportif ne l'a pas assigné à la main : on continue donc de rapprocher
  // côté client sur le nom d'équipe texte (Match.teamName) contre ctx.membership.teamScope —
  // équipe vide = scope non renseigné, on ne filtre alors pas (mieux vaut montrer un peu trop que
  // cacher un résultat réel à traiter).
  //
  // Directeur sportif : la vérification est "Optionnelle selon requires_result_verification"
  // (Bible §8) — un club qui n'utilise pas ce workflow ne doit voir AUCUN résultat "à vérifier"
  // (rien à confirmer, le CM lit directement le résultat saisi par le coach). Et un résultat déjà
  // vérifié (`verifiedAt` posé) ne compte plus, sinon le compteur ne redescend jamais à 0.
  const isCoach = ctx.membership.role === "coach";
  const isSportsDirector = ctx.membership.role === "sports_director";
  const [pendingResultsCount, setPendingResultsCount] = useState<number | null>(null);

  const loadPendingResults = useCallback(async () => {
    if (!isCoach && !isSportsDirector) return;
    const supabase = createClient();
    try {
      const [matches, requiresVerification] = await Promise.all([
        fetchClubMatches(supabase, ctx.organization.id),
        isSportsDirector ? fetchClubRequiresResultVerification(supabase, ctx.organization.id) : Promise.resolve(false),
      ]);
      const inScope =
        ctx.membership.teamScope.length === 0
          ? matches
          : matches.filter((m) => ctx.membership.teamScope.includes(m.teamName));
      if (isCoach) {
        setPendingResultsCount(inScope.filter((m) => m.status === "result_pending").length);
      } else {
        setPendingResultsCount(
          requiresVerification ? inScope.filter((m) => m.status === "result_received" && !m.verifiedAt).length : 0,
        );
      }
    } catch {
      setPendingResultsCount(null);
    }
  }, [ctx.organization.id, ctx.membership.teamScope, isCoach, isSportsDirector]);

  useEffect(() => {
    loadPendingResults();
  }, [loadPendingResults]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Aujourd&apos;hui</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            Bonjour {ctx.user.firstName}, voici ce qui nécessite votre attention.
          </h1>
        </div>
      </div>

      {(isCoach || isSportsDirector) && !!pendingResultsCount && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-blue-electric/40 bg-info-bg p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-fg/15 text-info-fg">
              <ShieldCheck className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div>
              <div className="text-[13.5px] font-extrabold text-text">
                {isCoach
                  ? `${pendingResultsCount} résultat${pendingResultsCount > 1 ? "s" : ""} à renseigner`
                  : `${pendingResultsCount} résultat${pendingResultsCount > 1 ? "s" : ""} à vérifier`}
              </div>
              <div className="text-[12px] text-text-soft">
                {isCoach ? "Un match est terminé, transmettez le score." : "Confirmez ou corrigez ce que le coach a saisi."}
              </div>
            </div>
          </div>
          <Button variant="secondary" className="h-9 px-3.5 text-[12.5px]" onClick={() => router.push("/matchcenter")}>
            Ouvrir Match Center
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <CardPremium>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-pale">
                Votre offre
              </div>
              <div className="mt-1 text-[22px] font-extrabold tracking-tight">{plan.name}</div>
              <div className="mt-1 text-[12.5px] text-[#B9C7EB]">{formatPlanPrice(plan)}</div>
            </div>
          </div>
          <div className="relative mt-5 grid grid-cols-3 gap-3.5">
            <Gauge label="Crédits visuels" value={formatPlanCredits(plan)} pct={creditsPct} />
            <Gauge label="Présences terrain" value="Non suivi" pct={null} />
            <Gauge label="Stockage" value="Non suivi" pct={null} />
          </div>
        </CardPremium>

        {quickActions.length > 0 && (
          <Card className="p-4">
            <div className="text-[14px] font-extrabold tracking-tight">Actions rapides</div>
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              {quickActions.map(({ icon: Icon, label, href }) => (
                <button
                  key={label}
                  onClick={() => router.push(href)}
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
        )}
      </div>

      {!isTreasurer && (
        <Card>
          <div className="flex items-center justify-between border-b border-divider px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-[#F5A623]" />
              <span className="text-[15px] font-extrabold tracking-tight">À traiter</span>
              <Badge tone="warning">{todo?.length ?? 0} élément{(todo?.length ?? 0) > 1 ? "s" : ""}</Badge>
            </div>
            {/* -m-3/p-3 agrandit la zone tactile réelle (19px de texte -> ~43px) sans changer la
                taille visuelle du lien — trouvé trop petit à l'audit mobile 375-430px. */}
            <button
              onClick={() => router.push("/content")}
              className="-m-3 p-3 text-[12.5px] font-bold text-brand-blue-electric"
            >
              Tout voir
            </button>
          </div>
          {error ? (
            <ErrorState message="Impossible de charger le contenu à traiter." onRetry={loadTodo} />
          ) : todo === null ? (
            <div>
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : todo.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Rien à traiter pour le moment" />
          ) : (
            todo.map((t) => (
              <div
                key={t.title}
                className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold text-text">{t.title}</span>
                  <span className="mt-0.5 block text-[12px] text-text-soft">{t.meta}</span>
                </span>
                {t.due && <span className="w-28 flex-none text-right text-[12px] font-bold text-due-late">{t.due}</span>}
                <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={() => router.push("/content")}>
                  {t.action}
                </Button>
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}

function Gauge({ label, value, pct }: { label: string; value: string; pct: number | null }) {
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
