"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

// Toast bas-droite, auto-disparition à 3,2 s — voir README.md § Micro-interactions. Pas de
// composant partagé équivalent dans src/components/ui/ à ce jour : petit utilitaire local,
// réutilisé par les écrans de ce périmètre (studio, newsroom, matchcenter, requests).
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => setMessage(msg), []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [message]);

  return { toastMessage: message, showToast };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-svfade fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-2.5 rounded-sv border border-border-strong bg-elevated px-4 py-3 text-[13px] font-bold text-text shadow-sv-modal"
    >
      <CheckCircle2 className="h-4 w-4 flex-none text-success-fg" aria-hidden />
      {message}
    </div>
  );
}
