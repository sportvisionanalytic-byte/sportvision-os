"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Download, Images } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { fetchClubMediaAssets } from "@/lib/data/club/content";
import { fetchPlayerMediaAssets } from "@/lib/data/player/media";
import { fetchClientLivrables } from "@/lib/data/projet/livrables";
import { createClient } from "@/lib/supabase/client";
import { MEDIA_FILTERS, matchesMediaFilter, type CollectionKind, type Collection, type MediaAsset, type MediaFilterKey } from "@/lib/types/content";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { MediaCard } from "./MediaCard";
import { MediaListTable } from "./MediaListTable";
import { CollectionCard } from "./CollectionCard";
import { CreateCollectionModal } from "./CreateCollectionModal";

type ViewMode = "grid" | "list";

let localCollectionSeq = 0;

// Bibliothèque de contenus — /content et /media (alias), voir ACTIONS.md § 13. Une seule page,
// filtrée par le contexte (README.md § Pas de duplication de pages) : le titre, le sous-titre,
// le jeu de données et la présence des collections varient selon le type d'organisation, jamais
// le composant.
export function ContentLibrary() {
  const { ctx } = useSession();
  const [filter, setFilter] = useState<MediaFilterKey>("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isPlayer = ctx.organization.type === "player";
  const isCoach = ctx.organization.type === "coach";
  const isProjet = ctx.organization.type === "generic";

  const [allAssets, setAllAssets] = useState<MediaAsset[]>([]);

  // Pour un joueur, les médias réels sont scopés par club_id (player_profiles.club_id, exposé via
  // organization.parentOrganizationId) — la RLS is_media_visible_to_family filtre déjà aux médias
  // visibles pour cette famille. Voir le plan Phase 2 § Décisions d'architecture n°4.
  const playerClubId = isPlayer ? ctx.organization.parentOrganizationId : undefined;

  useEffect(() => {
    const supabase = createClient();
    if (isPlayer) {
      if (!playerClubId) return;
      fetchPlayerMediaAssets(supabase, playerClubId).then((rows) => setAllAssets(rows));
      return;
    }
    if (isProjet) {
      fetchClientLivrables(supabase, ctx.organization.id).then((rows) => setAllAssets(rows));
      return;
    }
    let cancelled = false;
    fetchClubMediaAssets(supabase, ctx.organization.id).then((rows) => {
      if (!cancelled) setAllAssets(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [isPlayer, isProjet, playerClubId, ctx.organization.id]);

  const assets = useMemo(() => allAssets.filter((a) => matchesMediaFilter(a.kind, filter)), [allAssets, filter]);

  // Pas de table `collections` réelle (voir le plan Phase 1) — état local uniquement, comme
  // handleCreateCollection ci-dessous, déjà local-only avant ce branchement.
  const [collections, setCollections] = useState<Collection[]>([]);

  const title = isPlayer ? "Mes contenus" : isCoach ? "Contenus de mes joueurs" : isProjet ? "Mes livrables" : "Contenus";
  const subtitle = isPlayer
    ? "Les contenus où vous apparaissez, sélectionnés par votre club."
    : isCoach
      ? "Les contenus produits pour les joueurs que vous suivez."
      : isProjet
        ? "Les livrables de vos prestations, disponibles dès leur validation."
        : `${allAssets.length} élément${allAssets.length > 1 ? "s" : ""} · ${ctx.organization.name}`;

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }

  function handleDownloadAll() {
    showToast("Une archive de vos contenus vous sera envoyée par e-mail.");
  }

  function handleCreateCollection(name: string, kind: CollectionKind) {
    localCollectionSeq += 1;
    setCollections((prev) => [
      {
        id: `col-local-${localCollectionSeq}`,
        organizationId: ctx.organization.id,
        name,
        kind,
        assetIds: [],
        itemCount: 0,
        ownerId: ctx.user.id,
        ownerName: `${ctx.user.firstName} ${ctx.user.lastName}`,
        visibility: "organization",
      },
      ...prev,
    ]);
    setShowCreateModal(false);
    showToast("Collection créée.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">{title}</h1>
          <p className="mt-1 text-[13px] text-text-soft">{subtitle}</p>
        </div>
        <Button variant="dark" onClick={handleDownloadAll}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          Tout télécharger
        </Button>
      </div>

      {isPlayer && (
        <Card className="border-brand-blue-pale/40 bg-info-bg p-4 text-[13px] leading-relaxed text-info-fg">
          Ces contenus sont ceux où vous apparaissez, choisis par votre club. Les collections ne sont pas disponibles
          dans cet espace.
        </Card>
      )}

      {!isPlayer && !isProjet && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-extrabold tracking-tight">Collections</span>
            <Button variant="secondary" onClick={() => setShowCreateModal(true)}>
              Créer une collection
            </Button>
          </div>
          {collections.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-[12.5px] text-text-faint">
              Aucune collection pour le moment.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {collections.map((c) => (
                <CollectionCard key={c.id} collection={c} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {MEDIA_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                filter === f.key
                  ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                  : "border-border-strong bg-surface text-text-soft hover:border-brand-blue-pale",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-[11px] border border-border-strong bg-input-bg p-0.5">
          <button
            type="button"
            aria-label="Vue grille"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
            className={cn(
              "flex h-8 w-9 items-center justify-center rounded-[9px] transition-colors duration-sv",
              view === "grid" ? "bg-elevated text-text shadow-sv-card" : "text-text-faint hover:text-text-soft",
            )}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Vue liste"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            className={cn(
              "flex h-8 w-9 items-center justify-center rounded-[9px] transition-colors duration-sv",
              view === "list" ? "bg-elevated text-text shadow-sv-card" : "text-text-faint hover:text-text-soft",
            )}
          >
            <List className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {assets.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-info-bg text-info-fg">
            <Images className="h-5 w-5" aria-hidden />
          </span>
          <div className="text-[15px] font-extrabold tracking-tight">Aucun contenu pour ce filtre</div>
          <p className="max-w-[360px] text-[13.5px] leading-relaxed text-text-soft">
            Essayez un autre filtre, ou revenez plus tard : vos prochaines livraisons apparaîtront ici automatiquement.
          </p>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <MediaCard key={asset.id} asset={asset} />
          ))}
        </div>
      ) : (
        <MediaListTable assets={assets} />
      )}

      {showCreateModal && <CreateCollectionModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateCollection} />}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 animate-svfade rounded-xl border border-border-strong bg-elevated px-4 py-3 text-[13px] font-semibold text-text shadow-sv-dropdown"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
