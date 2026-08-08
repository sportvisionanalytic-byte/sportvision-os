"use client";

import { useCallback, useRef, useState } from "react";

// Toast — CHARTE.md § Micro-interactions : bas-droite, auto-disparition à 3,2 s. Hook local au
// module (pas de Toast dans src/components/ui aujourd'hui) : chaque page qui en a besoin
// l'instancie et affiche <ToastViewport toasts={toasts} /> — voir ce même dossier.

export interface ToastItem {
  id: number;
  message: string;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return { toasts, showToast };
}
