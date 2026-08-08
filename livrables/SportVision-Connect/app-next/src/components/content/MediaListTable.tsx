import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { MediaAsset } from "@/lib/types/content";
import { MEDIA_KIND_LABELS, MEDIA_STATUS_LABELS, MEDIA_STATUS_TONE, formatMediaDate, formatMediaSize } from "@/lib/types/content";
import { MediaThumb } from "./MediaThumb";

export function MediaListTable({ assets }: { assets: MediaAsset[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[56px_1.6fr_1fr_1fr_1fr] gap-3 border-b border-divider bg-bg-alt px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.04em] text-text-faint sm:grid">
        <span aria-hidden />
        <span>Nom</span>
        <span>Type</span>
        <span>Statut</span>
        <span className="text-right">Ajouté le</span>
      </div>
      {assets.map((asset) => (
        <Link
          key={asset.id}
          href={`/content/${asset.id}`}
          className="grid grid-cols-1 items-center gap-2 border-b border-divider px-5 py-3 last:border-0 hover:bg-row-hover sm:grid-cols-[56px_1.6fr_1fr_1fr_1fr] sm:gap-3"
        >
          <MediaThumb kind={asset.kind} className="hidden h-9 w-9 flex-none rounded-lg sm:flex [&>span]:hidden" />
          <span className="truncate text-[13px] font-bold text-text">{asset.name}</span>
          <span className="text-[12.5px] text-text-soft">{MEDIA_KIND_LABELS[asset.kind]}</span>
          <span>
            <Badge tone={MEDIA_STATUS_TONE[asset.status]}>{MEDIA_STATUS_LABELS[asset.status]}</Badge>
          </span>
          <span className="text-[12px] text-text-faint sm:text-right">
            {formatMediaDate(asset.createdAt)} · {formatMediaSize(asset.sizeBytes)}
          </span>
        </Link>
      ))}
    </Card>
  );
}
