"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Collection } from "@/lib/types/content";
import { COLLECTION_KIND_LABELS, formatMediaDate } from "@/lib/types/content";
import { getMediaAssetById } from "@/lib/mock/content";
import { MediaCard } from "./MediaCard";

// Panneau de collection — voir ACTIONS.md § 13. Partage par lien (30 jours par défaut, voir
// DATA_MODEL.md § Collection) et téléchargement global.
export function CollectionPanel({ collection }: { collection: Collection }) {
  const [toast, setToast] = useState<string | null>(null);
  const assets = collection.assetIds.map((id) => getMediaAssetById(id)).filter((a): a is NonNullable<typeof a> => !!a);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }

  function shareLink() {
    showToast("Lien de partage copié — valable 30 jours.");
  }

  function downloadAll() {
    showToast("Une archive de la collection vous sera envoyée par e-mail.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/content"
            aria-label="Retour à la bibliothèque"
            className="mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <div>
            <div className="text-[11.5px] font-bold uppercase tracking-[.03em] text-text-faint">
              {COLLECTION_KIND_LABELS[collection.kind]}
              {collection.date ? ` · ${formatMediaDate(collection.date)}` : ""}
            </div>
            <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">{collection.name}</h1>
            <p className="mt-1 text-[12.5px] text-text-soft">
              {collection.itemCount} élément{collection.itemCount > 1 ? "s" : ""} · par {collection.ownerName}
            </p>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <Button variant="secondary" onClick={shareLink}>
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Partager par lien
          </Button>
          <Button variant="dark" onClick={downloadAll}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Tout télécharger
          </Button>
        </div>
      </div>

      {collection.shareExpiresAt && (
        <p className="text-[12px] text-text-faint">
          Le lien de partage actif expire le {formatMediaDate(collection.shareExpiresAt)}.
        </p>
      )}

      {assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-[12.5px] text-text-faint">
          Cette collection ne contient aucun contenu pour le moment.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <MediaCard key={asset.id} asset={asset} />
          ))}
        </div>
      )}

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
