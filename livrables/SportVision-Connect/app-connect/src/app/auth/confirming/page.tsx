"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cheminInterne, consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { consumePendingClaim } from "@/lib/gallery/pending-claim";

// Étape intermédiaire après /auth/callback (session déjà posée côté serveur à ce stade) :
// rejoue le pending onboarding — voir lib/signup/pending-onboarding.ts, ne peut se faire que
// côté client (localStorage) — avant d'atterrir sur /dashboard. Échec journalisé seulement,
// jamais bloquant pour la connexion (même filet que auth/login/page.tsx).
//
// 10/09/2026 : la destination n'était jamais que /dashboard. Le parent parti de son invitation
// (/mes-invitations) ou du QR de l'équipe (/join/<code>) confirmait son adresse et arrivait sur un
// accueil qui ne lui disait rien de ce qui l'avait amené. `next` (transmis par /auth/callback)
// l'emporte, puis celui mémorisé avec l'inscription, puis /dashboard.
export default function ConfirmingPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      let suite = cheminInterne(new URLSearchParams(window.location.search).get("next"));
      try {
        const rejeu = await consumePendingOnboarding(supabase);
        suite = suite || rejeu?.suite || null;
        // Rattachement des achats galerie, au meme moment et pour la meme raison : c'est
        // le premier instant ou une vraie session existe. Appele meme sans achat en
        // attente, pour recuperer les commandes invitees eligibles d'un compte existant.
        await consumePendingClaim(supabase).catch(() => null);
      } catch (e) {
        console.error("[auth/confirming] rejeu de l'inscription en attente échoué :", e);
      }
      if (!cancelled) {
        router.replace(suite || "/dashboard");
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
