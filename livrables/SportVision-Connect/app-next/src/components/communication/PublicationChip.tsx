"use client";

import type { DragEvent, MouseEvent } from "react";
import { publicationStatusTone, toneDotClass } from "./statusTone";
import { cn } from "@/lib/cn";
import type { Publication } from "@/lib/types/communication";
import { formatTime } from "./calendarDates";

// Vignette compacte de publication — utilisée dans les vues Mois et Semaine du planning
// éditorial. Glisser-déposer natif HTML5 (CHARTE.md § Glisser-déposer) : `cursor: grab` au
// repos, `grabbing` en action.
export function PublicationChip({
  publication,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  publication: Publication;
  draggable: boolean;
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const tone = publicationStatusTone(publication.status);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-[8px] border border-border bg-surface-alt px-2 py-1.5 text-left text-[11px] font-bold text-text transition-[transform,box-shadow] duration-sv hover:-translate-y-px hover:shadow-sv-card-hover",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", toneDotClass(tone))} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{publication.title}</span>
      <span className="flex-none text-[10px] font-semibold text-text-faint">{formatTime(new Date(publication.scheduledAt))}</span>
    </button>
  );
}
