"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { coverFor, groupContentsByTeam } from "@/lib/contenus/groups";

export interface ContentItem {
  id: string;
  title: string;
  /** Valeurs réelles (CHECK constraint club_media.type) : photo | video | logo | document | creation. */
  type: string;
  team: string | null;
  link: string | null;
  tags: string | null;
  createdAt: string;
}

type TabKey = "tous" | "photos" | "videos" | "reels" | "favoris";

const TABS: { key: TabKey; label: string }[] = [
  { key: "tous", label: "Tous" },
  { key: "photos", label: "Photos" },
  { key: "videos", label: "Vidéos" },
  { key: "reels", label: "Reels" },
  { key: "favoris", label: "Favoris" },
];

function mediaAssetId(item: ContentItem): string {
  return `media-${item.id}`;
}

function isReel(item: ContentItem): boolean {
  // Le CHECK constraint de club_media n'autorise pas encore la valeur 'reel' — heuristique sur le
  // tag posé par le club en attendant (voir page.tsx pour le détail de la décision).
  return item.type === "reel" || (item.type === "video" && (item.tags ?? "").toLowerCase().includes("reel"));
}

function matchesTab(item: ContentItem, tab: TabKey, favoriteIds: Set<string>): boolean {
  switch (tab) {
    case "tous":
      return true;
    case "photos":
      return item.type === "photo";
    case "videos":
      return item.type === "video";
    case "reels":
      return isReel(item);
    case "favoris":
      return favoriteIds.has(mediaAssetId(item));
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function ContentGallery({
  items,
  favoriteIds: initialFavoriteIds,
  hasClub,
}: {
  items: ContentItem[];
  favoriteIds: string[];
  hasClub: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("tous");
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [favBusy, setFavBusy] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => items.filter((it) => matchesTab(it, tab, favoriteIds)), [items, tab, favoriteIds]);
  const groups = useMemo(() => groupContentsByTeam(filtered), [filtered]);
  const flatView = tab === "favoris";

  const flatSorted = useMemo(
    () => [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [filtered],
  );

  const openGroup = groups.find((g) => g.key === openGroupKey) ?? null;
  const galleryItems = flatView ? flatSorted : openGroup?.items ?? [];

  async function toggleFavorite(item: ContentItem) {
    const assetId = mediaAssetId(item);
    if (favBusy.has(assetId)) return;
    setFavBusy((s) => new Set(s).add(assetId));
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setFavBusy((s) => {
        const next = new Set(s);
        next.delete(assetId);
        return next;
      });
      return;
    }
    const wasFavorite = favoriteIds.has(assetId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
    const result = wasFavorite
      ? await supabase.from("contenu_favoris").delete().eq("user_id", user.id).eq("media_asset_id", assetId)
      : await supabase.from("contenu_favoris").insert({ user_id: user.id, media_asset_id: assetId });
    if (result.error) {
      // Rollback optimiste en cas d'échec réseau/RLS.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(assetId);
        else next.delete(assetId);
        return next;
      });
    }
    setFavBusy((s) => {
      const next = new Set(s);
      next.delete(assetId);
      return next;
    });
  }

  function openLightboxAt(itemId: string) {
    const idx = galleryItems.findIndex((i) => i.id === itemId);
    if (idx >= 0) setLightboxIndex(idx);
  }

  const lbItem = lightboxIndex !== null ? galleryItems[lightboxIndex] : null;

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      {!openGroup && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">
              {tab === "favoris" ? "Mes favoris" : "Mes contenus"}
            </h1>
            <p className="max-w-[560px] text-[15px] text-text-tertiary">
              Retrouvez toutes vos photos et vidéos SportVision.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setOpenGroupKey(null);
                  }}
                  className="rounded-sv-pill px-4 py-2.5 text-[14px] font-medium transition-colors duration-150"
                  style={{
                    color: active ? "#C084FC" : "#C7C7DE",
                    background: active ? "rgba(168,85,247,.16)" : "rgba(255,255,255,.05)",
                    border: `1px solid ${active ? "rgba(192,132,252,.4)" : "rgba(255,255,255,.09)"}`,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {flatView ? (
            <MediaGrid
              items={flatSorted}
              favoriteIds={favoriteIds}
              onOpen={openLightboxAt}
              onToggleFavorite={toggleFavorite}
            />
          ) : groups.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setOpenGroupKey(g.key)}
                  className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface text-left transition-colors duration-150 hover:border-[rgba(192,132,252,.5)]"
                >
                  <div className="relative h-[130px]" style={{ background: coverFor(g.key) }}>
                    {g.hasNew && (
                      <span className="absolute left-3 top-3 rounded-sv-pill bg-text px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.04em] text-bg">
                        Nouveau
                      </span>
                    )}
                    <span className="absolute right-3 top-3 rounded-sv-pill bg-black/45 px-2.5 py-1 text-[11px] font-medium text-text">
                      {g.items.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-4">
                    <span className="font-sora text-[16px] font-semibold">{g.title}</span>
                    <span className="text-[13px] text-text-tertiary">
                      {[g.photoCount ? `${g.photoCount} photo${g.photoCount > 1 ? "s" : ""}` : null, g.videoCount ? `${g.videoCount} vidéo${g.videoCount > 1 ? "s" : ""}` : null]
                        .filter(Boolean)
                        .join(" · ") || formatDate(g.lastDate)}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 font-sora text-[14px] font-semibold text-contenus">
                      Ouvrir
                      <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">arrow_forward</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState hasClub={hasClub} tab={tab} />
          )}
        </>
      )}

      {openGroup && (
        <div className="flex flex-col gap-5">
          <button
            type="button"
            onClick={() => setOpenGroupKey(null)}
            className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary transition-colors hover:text-text"
          >
            <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
            Mes contenus
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="font-sora text-[24px] font-bold tracking-tight lg:text-[28px]">{openGroup.title}</h1>
              <span className="text-[14px] text-text-tertiary">
                {openGroup.items.length} contenu{openGroup.items.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <MediaGrid
            items={openGroup.items}
            favoriteIds={favoriteIds}
            onOpen={openLightboxAt}
            onToggleFavorite={toggleFavorite}
          />
        </div>
      )}

      {lbItem && (
        <Lightbox
          items={galleryItems}
          index={lightboxIndex!}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}

function EmptyState({ hasClub, tab }: { hasClub: boolean; tab: TabKey }) {
  const text = !hasClub
    ? "Rejoignez votre club pour retrouver ici les contenus liés à votre équipe."
    : tab === "favoris"
      ? "Vous n'avez encore ajouté aucun favori. Ouvrez un contenu et touchez le cœur pour le retrouver ici."
      : "Aucun contenu pour le moment. Vos prochains contenus apparaîtront ici après leur livraison.";
  return (
    <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-contenus-bg">
        <span className="material-symbols-rounded !text-[24px] text-contenus" aria-hidden="true">photo_library</span>
      </span>
      <span className="font-sora text-[18px] font-semibold">Aucun contenu ici</span>
      <p className="text-[14px] leading-relaxed text-text-tertiary">{text}</p>
    </div>
  );
}

function MediaGrid({
  items,
  favoriteIds,
  onOpen,
  onToggleFavorite,
}: {
  items: ContentItem[];
  favoriteIds: Set<string>;
  onOpen: (id: string) => void;
  onToggleFavorite: (item: ContentItem) => void;
}) {
  if (items.length === 0) return <EmptyState hasClub tab="tous" />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const assetId = mediaAssetId(item);
        const fav = favoriteIds.has(assetId);
        return (
          <div
            key={item.id}
            className="group relative aspect-square cursor-pointer overflow-hidden rounded-sv border border-white/[.07] transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
            style={{ background: coverFor(item.id) }}
            onClick={() => onOpen(item.id)}
          >
            {item.type === "video" && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55">
                  <span className="material-symbols-rounded !text-[24px] text-white" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                    play_arrow
                  </span>
                </span>
              </span>
            )}
            <span className="absolute bottom-2 left-2.5 font-mono text-[9px] text-white/75">
              {formatDate(item.createdAt)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(item);
              }}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-[11px] bg-black/55 opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
              style={fav ? { opacity: 1 } : undefined}
              aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
            >
              <span
                className="material-symbols-rounded !text-[18px]"
                style={{ fontVariationSettings: `'FILL' ${fav ? 1 : 0}`, color: fav ? "#F472B6" : "#fff" }}
              >
                favorite
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  favoriteIds,
  onToggleFavorite,
}: {
  items: ContentItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  favoriteIds: Set<string>;
  onToggleFavorite: (item: ContentItem) => void;
}) {
  const item = items[index];
  if (!item) return null;
  const assetId = mediaAssetId(item);
  const fav = favoriteIds.has(assetId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[rgba(4,3,12,.94)]" role="dialog" aria-modal="true">
      <div className="flex flex-none items-center gap-3 p-4">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-white/[.08] hover:bg-white/[.16]"
        >
          <span className="material-symbols-rounded !text-[21px]" aria-hidden="true">close</span>
        </button>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-sora text-[14px] font-semibold">{item.title}</span>
          <span className="text-[12px] text-text-tertiary">
            {index + 1} / {items.length}
          </span>
        </div>
        <div className="ml-auto flex flex-none gap-2.5">
          <button
            type="button"
            onClick={() => onToggleFavorite(item)}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-sv border"
            style={{
              background: fav ? "rgba(244,114,182,.14)" : "rgba(255,255,255,.08)",
              borderColor: fav ? "rgba(244,114,182,.4)" : "transparent",
            }}
          >
            <span
              className="material-symbols-rounded !text-[21px]"
              style={{ fontVariationSettings: `'FILL' ${fav ? 1 : 0}`, color: fav ? "#F472B6" : "#F7F7FB" }}
            >
              favorite
            </span>
          </button>
          {item.link ? (
            <a
              href={item.link}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[42px] w-[42px] items-center justify-center rounded-sv bg-white/[.08] text-text hover:bg-white/[.16]"
            >
              <span className="material-symbols-rounded !text-[21px]" aria-hidden="true">download</span>
            </a>
          ) : (
            <span className="flex h-[42px] w-[42px] items-center justify-center rounded-sv bg-white/[.04] text-text-faint">
              <span className="material-symbols-rounded !text-[21px]" aria-hidden="true">download</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 items-center justify-center gap-3 px-3 pb-3">
        <button
          type="button"
          onClick={() => onIndexChange(Math.max(0, index - 1))}
          disabled={index === 0}
          className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-full bg-white/[.08] hover:bg-white/[.18] disabled:opacity-30"
        >
          <span className="material-symbols-rounded !text-[24px]" aria-hidden="true">chevron_left</span>
        </button>
        <div className="flex h-full flex-1 min-w-0 items-center justify-center">
          {item.link ? (
            item.type === "video" ? (
              <video src={item.link} controls className="max-h-full max-w-full rounded-[18px] border border-white/10" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- média distant (bucket Storage club_media), pas un asset local optimisable par next/image
              <img
                src={item.link}
                alt={item.title}
                loading="lazy"
                className="max-h-full max-w-full rounded-[18px] border border-white/10 object-contain"
              />
            )
          ) : (
            <div
              className="flex aspect-square w-full max-w-[420px] items-end rounded-[18px] border border-white/10 p-3.5"
              style={{ background: coverFor(item.id) }}
            >
              <span className="font-mono text-[11px] text-white/70">Aperçu indisponible</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onIndexChange(Math.min(items.length - 1, index + 1))}
          disabled={index === items.length - 1}
          className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-full bg-white/[.08] hover:bg-white/[.18] disabled:opacity-30"
        >
          <span className="material-symbols-rounded !text-[24px]" aria-hidden="true">chevron_right</span>
        </button>
      </div>
    </div>
  );
}
