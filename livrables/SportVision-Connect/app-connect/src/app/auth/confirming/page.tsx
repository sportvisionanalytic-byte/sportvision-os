"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding } from "@/lib/signup/pending-onboarding";

// Étape intermédiaire après /auth/callback (session déjà posée côté serveur à ce stade) :
// rejoue le pending onboarding — voir lib/signup/pending-onboarding.ts, ne peut se faire que
// côté client (localStorage) — avant d'atterrir sur /dashboard. Échec journalisé seulement,
// jamais bloquant pour la connexion (même filet que auth/login/page.tsx).
export default function ConfirmingPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      try {
        await consumePendingOnboarding(supabase);
      } catch (e) {
        console.error("[auth/confirming] rejeu de l'inscription en attente échoué :", e);
      }
      if (!cancelled) {
        router.replace("/dashboard");
        router.refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text">
      <span className="material-symbols-rounded animate-spin !text-[28px] text-[#8CA9FF]" aria-hidden="true">progress_activity</span>
      <p className="text-[14px] text-text-tertiary">Connexion en cours…</p>
    </div>
  );
}
