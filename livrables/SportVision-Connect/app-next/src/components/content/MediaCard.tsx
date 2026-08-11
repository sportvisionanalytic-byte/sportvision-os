import Link from "next/link";
import { Download, Heart } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { MediaAsset } from "@/lib/types/content";
import { MEDIA_STATUS_LABELS, MEDIA_STATUS_TONE, formatMediaDuration } from "@/lib/types/content";
import { MediaThumb } from "./MediaThumb";

interface MediaCardProps {
  asset: MediaAsset;
  /** Coeur favori + bouton "Télécharger" sur la carte — espace Joueur uniquement pour l'instant
   * (brief Fouka § 9 et § 10), voir ContentLibrary.tsx. `undefined` = aucun des deux affiché,
   * comportement strictement inchangé pour club/générique. */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onDownload?: () => void;
}

export function MediaCard({ asset, isFavorite, onToggleFavorite, onDownload }: MediaCardProps) {
  return (
    <Card className="group relative flex flex-col overflow-hidden hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover">
      <Link href={`/content/${asset.id}`} className="contents">
        <MediaThumb kind={asset.kind} className="aspect-[4/3] w-full">
          {asset.durationSeconds !== undefined && (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white">
              {formatMediaDuration(asset.durationSeconds)}
            </span>
          )}
        </MediaThumb>
        <div className="flex flex-col gap-1.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-[12.5px] font-bold text-text">{asset.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-faint">v{asset.version}</span>
            {asset.status !== "validated" && (
              <Badge tone={MEDIA_STATUS_TONE[asset.status]}>{MEDIA_STATUS_LABELS[asset.status]}</Badge>
            )}
          </div>
        </div>
      </Link>

      {onToggleFavorite && (
        <button
          type="button"
          aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.preventDefault();
            onToggleFavorite();
          }}
          className={cn(
            "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition-colors",
            isFavorite ? "text-[#FF6B81]" : "text-white hover:text-[#FF6B81]",
          )}
        >
          <Heart className="h-3.5 w-3.5" fill={isFavorite ? "currentColor" : "none"} aria-hidden />
        </button>
      )}

      {onDownload && (
        <button
          type="button"
          aria-label="Télécharger"
          onClick={(e) => {
            e.preventDefault();
            onDownload();
          }}
          className="absolute bottom-[52px] right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </Card>
  );
}
