"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fetchStudioTemplates } from "@/lib/data/club/studio";
import { createClient } from "@/lib/supabase/client";
import {
  STUDIO_CATEGORY_LABELS,
  STUDIO_CATEGORY_ORDER,
  type StudioCategory,
  type StudioTemplate,
} from "@/lib/types/studio";

// Studio Club+ — marketplace de modèles. Voir ACTIONS.md § 6 et DATA_MODEL.md § StudioTemplate.
// 47 modèles répartis sur 7 catégories, désormais lus depuis la table `studio_templates`
// (migration-clubplus-v38-studio-sponsors.sql) au lieu de la constante STUDIO_TEMPLATES —
// catalogue dynamique, pilotable par le staff SportVision sans déploiement.

type CategoryFilter = "all" | StudioCategory;

export default function StudioPage() {
  const { ctx } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [templates, setTemplates] = useState<StudioTemplate[] | null>(null);

  const allowed = canAccess(ctx, "studio");

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const supabase = createClient();
    fetchStudioTemplates(supabase)
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templates ?? []).filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (q && !t.name.toLowerCase().includes(q) && !STUDIO_CATEGORY_LABELS[t.category].toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [templates, search, category]);

  // Message dédié (pas le générique de LockedModule, qui suggère qu'un changement de formule
  // débloque le module "à tout moment") : "studio" est absent de READY_MODULES sans exception,
  // aucune formule ne le débloque aujourd'hui — trouvé lors de l'audit démo Club+ du 19/08/2026.
  if (!allowed) return <LockedModule title="Studio Club+" message="Studio arrive bientôt. Ce module n'est pas encore disponible, quelle que soit votre formule actuelle." />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Club+</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Studio</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          47 modèles prêts à personnaliser pour vos réseaux : club, logo, couleurs, sponsors et
          saison sont préremplis automatiquement.
        </p>
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-faint" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un modèle…"
            className="h-10 w-full rounded-sv border border-border-strong bg-input-bg pl-9 pr-3 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.1)]"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <CategoryChip active={category === "all"} onClick={() => setCategory("all")}>
            Tout
          </CategoryChip>
          {STUDIO_CATEGORY_ORDER.map((c) => (
            <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
              {STUDIO_CATEGORY_LABELS[c]}
            </CategoryChip>
          ))}
        </div>
      </div>

      {templates === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">
          Aucun modèle ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((t) => (
            <Card
              key={t.code}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/studio/${t.code}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") router.push(`/studio/${t.code}`);
              }}
              className="group cursor-pointer p-0 hover:-translate-y-0.5 hover:border-brand-blue-electric hover:shadow-sv-card-hover"
            >
              <div
                className="flex h-28 items-center justify-center rounded-t-sv-card text-[11px] font-mono font-medium uppercase tracking-wide text-white/80"
                style={{
                  background:
                    "repeating-linear-gradient(125deg, #1B2A6B 0px, #1B2A6B 14px, #24327A 14px, #24327A 28px)",
                }}
              >
                aperçu · {t.name.toLowerCase()}
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="accent">{STUDIO_CATEGORY_LABELS[t.category]}</Badge>
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-text-soft">
                    <Sparkles className="h-3 w-3 text-brand-cyan" aria-hidden />
                    {t.creditCost} crédit{t.creditCost > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-[14.5px] font-extrabold tracking-tight">{t.name}</div>
                <div className="text-[12px] text-text-faint">Livraison sous {t.deliveryDelay}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
        active
          ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
          : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric",
      )}
    >
      {children}
    </button>
  );
}
