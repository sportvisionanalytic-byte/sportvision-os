"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding } from "@/lib/signup/pending-onboarding";

// Étape intermédiaire après /auth/callback (session déjà posée côté serveur à ce stade) :
// rejoue le pending onboarding — voir lib/signup/pending-onboarding.ts, ne peut se faire que
// côté client (localStorage) — avant d'atterrir sur /dashboard. Échec journalisé seulement,
// jamais bloquant pour la connexion (même filet que auth/login/page.tsx). Repris à l'identique
// du pendant app-connect (src/app/auth/confirming/page.tsx), qui n'avait jamais d'équivalent ici
// avant le correctif du 17/08/2026 sur la confirmation d'e-mail Club+.
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
      <Loader2 className="h-7 w-7 animate-spin text-brand-blue-electric" aria-hidden />
      <p className="text-[14px] text-text-soft">Connexion en cours…</p>
    </div>
  );
}
