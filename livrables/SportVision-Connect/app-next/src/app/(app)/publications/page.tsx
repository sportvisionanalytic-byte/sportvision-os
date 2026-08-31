"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/supabase/realtime";
import { fetchContenus, type Contenu } from "@/lib/data/shared/contenus";
import { fetchContenuStatsByIds, type ContenuStat } from "@/lib/data/shared/contenu-stats";

// /publications — historique réel des contenus publiés/programmés (table `contenus`, filtrée sur
// statut).
//
// Mise à jour du 10/08/2026 (Phase 5, saisie manuelle de stats) : les colonnes "Portée"/
// "Interactions" ci-dessous étaient volontairement absentes jusqu'ici — aucune métrique de
// diffusion n'existait dans le schéma (Metricool n'est utilisé qu'à la main par les CM, aucune
// intégration API réelle). Elles réapparaissent maintenant que `contenu_stats`
// (migration-cm-contenu-stats.sql) existe : une ligne par contenu PUBLIÉ, saisie à la main par le
// CM propriétaire ou le Lead CM. Un contenu "programme" (pas encore publié) ou "publie" mais
// jamais renseigné affiche toujours "—", jamais 0 — et toute valeur affichée porte la mention
// "saisi manuellement" (jamais "synchronisé" : ce n'est toujours pas une intégration automatique).
export default function PublicationsPage() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule />;
  if (resolution.status === "loading") return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;

  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Publications</h1>
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <Inbox className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Publications pas encore reliées</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Publications. Contactez votre
              interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <PublicationsHistory clientId={resolution.clientId} />;
}

function PublicationsHistory({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const [items, setItems] = useState<Contenu[] | null>(null);
  const [statsById, setStatsById] = useState<Map<string, ContenuStat>>(new Map());
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setItems(null);
    try {
      const supabase = createClient();
      const all = await fetchContenus(supabase, clientId);
      const visibles = all.filter((c) => c.statut === "publie" || c.statut === "programme");
      setItems(visibles);
      // Les stats n'ont de sens que pour les contenus déjà publiés — un "programme" n'a jamais
      // de ligne contenu_stats possible (pas encore diffusé).
      const publieIds = visibles.filter((c) => c.statut === "publie").map((c) => c.id);
      setStatsById(await fetchContenuStatsByIds(supabase, publieIds));
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Sync temps réel (migration-connect-v42-enable-realtime-sync.sql) : nouveau contenu
  // publié/programmé par le CM — même colonne de scoping que fetchContenus (contenus_client_select
  // filtre sur client_id, migration-clubplus-v34-club-messages-contenus-access.sql). Rejoue
  // reload() ci-dessus (contenus + stats), ne duplique aucune logique de requête. Dégrade
  // silencieusement tant que la migration v42 n'a pas été exécutée (voir realtime.ts).
  useEffect(() => {
    const supabase = createClient();
    const channel = subscribeTable(
      supabase,
      `publications-contenus-${clientId}`,
      "contenus",
      `client_id=eq.${clientId}`,
      reload,
    );
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Publications</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Publications de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger les publications.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {items === null ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement…</div>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <Inbox className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucune publication pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {/* Rangée d'en-têtes cachée sous `sm` : à largeur fixe (contrairement aux lignes de
              données juste en dessous, en `flex-wrap`), elle débordait hors du viewport sur
              mobile (audit du 31/08/2026, Playwright 390px) — les données elles-mêmes restent
              lisibles une fois repliées, la légende Portée/Interactions ci-dessous suffit. */}
          <div className="hidden items-center gap-3.5 border-b border-divider px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.04em] text-text-faint sm:flex">
            <span className="min-w-0 flex-1">Contenu</span>
            <span className="w-20 flex-none text-right">Portée</span>
            <span className="w-20 flex-none text-right">Interactions</span>
            <span className="w-28 flex-none text-right">Date</span>
            <span className="w-[74px] flex-none text-right">Statut</span>
          </div>
          <div className="px-5 pb-1 pt-2 text-[11px] text-text-faint">
            Portée/Interactions : saisies manuellement par votre Community Manager, jamais une synchronisation automatique.
          </div>
          {items.map((c) => {
            const stat = c.statut === "publie" ? statsById.get(c.id) : undefined;
            return (
              <Link
                key={c.id}
                href={`/communication/publications/${c.id}`}
                className="flex flex-wrap items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-text">{c.titre}</span>
                  <span className="mt-0.5 block text-[12px] text-text-soft">{c.plateforme ?? "—"}</span>
                </span>
                <span className="w-20 flex-none text-right text-[12.5px] font-bold text-text">
                  {stat?.portee != null ? stat.portee.toLocaleString("fr-FR") : "—"}
                </span>
                <span className="w-20 flex-none text-right text-[12.5px] font-bold text-text">
                  {stat?.engagement != null ? stat.engagement.toLocaleString("fr-FR") : "—"}
                </span>
                <span className="w-28 flex-none text-right text-[12px] text-text-soft">{c.datePublication ?? c.datePrevue ?? "—"}</span>
                <span className="w-[74px] flex-none text-right">
                  <Badge tone={c.statut === "publie" ? "success" : "info"}>{c.statut === "publie" ? "Publié" : "Programmé"}</Badge>
                </span>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
