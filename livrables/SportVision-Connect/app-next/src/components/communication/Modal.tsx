"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

// Modale générique du module — CHARTE.md § Espacements, rayons, ombres (rayon 20-22px,
// `shadow-sv-modal`) et § Animations (`svfade`). Chaque modale spécifique du module
// (transmission d'information, nouvelle publication, créneau CM…) s'appuie dessus.
export function Modal({
  open,
  onClose,
  title,
  children,
  widthClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClassName?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Fermer la fenêtre"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-svfade relative max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-sv-modal border border-border bg-surface p-6 shadow-sv-modal",
          widthClassName,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[18px] font-extrabold tracking-tight">{title}</h2>
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
