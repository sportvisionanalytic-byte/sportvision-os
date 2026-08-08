"use client";

import { CheckCircle2 } from "lucide-react";
import type { ToastItem } from "./useToast";

export function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2.5" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-svfade flex items-center gap-2.5 rounded-xl border border-border bg-elevated px-4 py-3 text-[13px] font-bold text-text shadow-sv-modal"
        >
          <CheckCircle2 className="h-4 w-4 flex-none text-success-fg" aria-hidden />
          {t.message}
        </div>
      ))}
    </div>
  );
}
