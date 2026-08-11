"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Images, Sparkles, UserPlus } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

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

const QUICK_ACTIONS = [
  { icon: Sparkles, label: "Demander un visuel", href: "/studio" },
  { icon: Calendar, label: "Ajouter un événement", href: "/calendar" },
  { icon: Images, label: "Consulter les contenus", href: "/content" },
  { icon: UserPlus, label: "Inviter un utilisateur", href: "/users" },
];

export function ClubPlusDashboard() {
  const { ctx } = useSession();
  const router = useRouter();
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
  const [todo, setTodo] = useState<TodoItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    setError(false);
    async function load() {
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
    }
    load();
  }, [ctx.organization.id]);

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

        <Card className="p-4">
          <div className="text-[14px] font-extrabold tracking-tight">Actions rapides</div>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map(({ icon: Icon, label, href }) => (
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
      </div>

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
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">Impossible de charger le contenu à traiter.</div>
        ) : todo === null ? (
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">Chargement…</div>
        ) : todo.length === 0 ? (
          <div className="px-5 py-6 text-center text-[13px] text-text-soft">Rien à traiter pour le moment.</div>
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
