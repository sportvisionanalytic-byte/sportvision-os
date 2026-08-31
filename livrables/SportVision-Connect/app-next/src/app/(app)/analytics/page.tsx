"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Eye, Heart, Radar } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/communication/MetricCard";
import { LockedModule } from "@/components/ui/LockedModule";
import { EmptyState } from "@/components/communication/EmptyState";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchContenusPubliesAvecStats, sumStat, type ContenuAvecStats } from "@/lib/data/shared/contenu-stats";

// /analytics — remplace le mock (lib/mock/communication.ts, AnalyticsSummary + Publication.reach/
// engagement/views, jamais réel) par de vraies requêtes sur `contenus` + `contenu_stats`
// (migration-cm-contenu-stats.sql, Phase 5 du plan Tier C). Décidé avec Fouka (10/08) : pas
// d'intégration Metricool réelle pour l'instant (plan payant + token absents) — la donnée vient
// d'une saisie manuelle du CM, contenu par contenu, jamais d'une synchronisation automatique.
//
// Deux différences assumées avec le mock qu'il remplace :
// 1. Pas de tuile "Abonnés" : aucune donnée de suivi d'audience n'existe nulle part dans le
//    schéma réel (ni Metricool ni ailleurs) — retirée plutôt qu'inventée.
// 2. Pas de progression en % (deltaPct) : la table contenu_stats n'a que quelques semaines
//    d'existence, comparer à une période antérieure produirait un delta fondé sur une saisie
//    quasi-vide. MetricCard gère déjà `deltaPct` en optionnel (omis = pas d'indicateur) : on ne
//    l'utilise simplement pas ici tant qu'un historique réel n'existe pas.
// Seuls les contenus au statut "publie" sont pris en compte (fetchContenusPubliesAvecStats) ; un
// contenu publié sans stats saisies n'entre dans aucun total (sumStat renvoie null, jamais 0).
export default function AnalyticsPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "analytics")) return <LockedModule />;
  return <AnalyticsGate />;
}

function AnalyticsGate() {
  const { ctx } = useSession();
  const resolution = useClientId();

  // Message dédié — même correctif et même raison exacte que messages/page.tsx (31/08/2026,
  // audit complet) : useClientId() "locked" est définitif pour ce type d'espace, jamais débloqué
  // par un changement de contrat, contrairement à ce que sous-entend le message générique de
  // LockedModule.
  if (resolution.status === "locked") {
    return (
      <LockedModule message="Les statistiques ne sont pas encore disponibles pour ce type d'espace, quel que soit votre contrat." />
    );
  }
  if (resolution.status === "loading") {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[24px] font-extrabold tracking-tight">Statistiques</h1>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="max-w-md text-[13.5px] text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Statistiques.
          </div>
        </Card>
      </div>
    );
  }
  return <AnalyticsScreen clientId={resolution.clientId} />;
}

function AnalyticsScreen({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<ContenuAvecStats[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setItems(null);
    try {
      const supabase = createClient();
      setItems(await fetchContenusPubliesAvecStats(supabase, clientId));
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const reach = items ? sumStat(items, "portee") : null;
  const views = items ? sumStat(items, "vues") : null;
  const engagement = items ? sumStat(items, "engagement") : null;
  const best = (items ?? [])
    .filter((c) => c.stats?.portee != null)
    .sort((a, b) => (b.stats?.portee ?? 0) - (a.stats?.portee ?? 0))
    .slice(0, 3);

  const fmt = (n: number | null) => (n != null ? n.toLocaleString("fr-FR") : "—");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight">Statistiques</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">
          Saisies manuellement par votre Community Manager, contenu par contenu — pas de synchronisation automatique.
        </p>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les statistiques.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {items === null ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Card className="p-4 text-[13px] text-text-soft">Chargement…</Card>
          <Card className="p-4 text-[13px] text-text-soft">Chargement…</Card>
          <Card className="p-4 text-[13px] text-text-soft">Chargement…</Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <MetricCard icon={Radar} label="Portée" value={fmt(reach)} hint="Saisi manuellement" />
          <MetricCard icon={Eye} label="Vues" value={fmt(views)} hint="Saisi manuellement" />
          <MetricCard icon={Heart} label="Engagement" value={fmt(engagement)} hint="Saisi manuellement" />
        </div>
      )}

      <Card>
        <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">Vos meilleures publications</div>
        {items === null ? (
          <div className="p-6 text-[13px] text-text-soft">Chargement…</div>
        ) : best.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Radar}
              title="Aucune statistique saisie pour l'instant"
              subtitle="Les chiffres apparaissent dès que votre Community Manager les renseigne pour un contenu publié."
            />
          </div>
        ) : (
          // Rangées non cliquables (contrairement à l'ancienne version sur mock) : la fiche
          // détail /communication/publications/[id] reste bâtie sur des identifiants mock et ne
          // sait pas résoudre un vrai id `contenus` — pointer vers elle produirait un faux lien
          // "introuvable". Hors périmètre de cette phase (reconstruire cette fiche appartient au
          // module "communication", pas à "analytics"/"reports"/"publications").
          best.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-text">{c.titre}</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">{c.plateforme ?? "—"}</span>
              </span>
              <span className="w-28 flex-none text-right text-[12.5px] font-bold text-text">{fmt(c.stats?.portee ?? null)} portée</span>
              <span className="w-32 flex-none text-right text-[12.5px] font-bold text-text-soft">
                {fmt(c.stats?.engagement ?? null)} interactions
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
