import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { MediaAsset } from "@/lib/types/content";
import { MEDIA_STATUS_LABELS, MEDIA_STATUS_TONE, formatMediaDuration } from "@/lib/types/content";
import { MediaThumb } from "./MediaThumb";

export function MediaCard({ asset }: { asset: MediaAsset }) {
  return (
    <Link href={`/content/${asset.id}`}>
      <Card className="flex flex-col overflow-hidden hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover">
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
      </Card>
    </Link>
  );
}
