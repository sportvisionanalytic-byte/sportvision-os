"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { cheminInterneSur } from "@/lib/supabase/chemin-retour";

// Étape intermédiaire après /auth/callback (session déjà posée côté serveur à ce stade) :
// rejoue le pending onboarding — voir lib/signup/pending-onboarding.ts, ne peut se faire que
// côté client (localStorage) — avant d'atterrir sur /dashboard. Échec journalisé seulement,
// jamais bloquant pour la connexion (même filet que auth/login/page.tsx). Repris à l'identique
// du pendant app-connect (src/app/auth/confirming/page.tsx), qui n'avait jamais d'équivalent ici
// avant le correctif du 17/08/2026 sur la confirmation d'e-mail Club+.
//
// 10/09/2026 (audit des créations de compte) — deux trous bouchés :
//  - `?next=` : un coach invité qui confirme son adresse doit revenir sur SON invitation
//    (/rejoindre?token=…), pas sur un tableau de bord vide où rien ne lui dit quoi faire ;
//  - un refus DÉFINITIF du serveur (lien d'activation expiré ou déjà utilisé entre l'inscription et
//    le clic) partait en console, et la personne atterrissait sur « Aucun espace disponible » sans
//    savoir pourquoi. On lui montre désormais la phrase du serveur, en français.
export default function ConfirmingPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmingContent />
    </Suspense>
  );
}

function ConfirmingContent() {
  const router = useRouter();
  const next = cheminInterneSur(useSearchParams().get("next"));
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      try {
        const resultat = await consumePendingOnboarding(supabase);
        // Club+ Gratuit refusé : le compte a déjà un club (décisions Club+ du 10/09/2026, n° 2).
        // /signup-free le dit et propose d'ouvrir cet espace ; on n'y bascule pas en silence.
        if (resultat?.dejaRattache) {
          if (!cancelled) router.replace("/signup-free");
          return;
        }
      } catch (e) {
        console.error("[auth/confirming] rejeu de l'inscription en attente échoué :", e);
        if (!cancelled && (e as { definitive?: boolean }).definitive) {
          setErreur(e instanceof Error ? e.message : "La finalisation de votre inscription a échoué.");
          return;
        }
      }
      if (!cancelled) {
        router.replace(next ?? "/dashboard");
        router.refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  if (erreur) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-text">
        <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-sv-modal border border-border bg-elevated p-7 text-center shadow-sv-modal">
          <AlertCircle className="h-7 w-7 text-danger-fg" aria-hidden />
          <h1 className="text-[19px] font-extrabold tracking-tight">Votre adresse est confirmée</h1>
          <p className="text-[13.5px] leading-relaxed text-text-soft">
            Mais votre espace n&apos;a pas pu être finalisé : {erreur}
          </p>
          <Button className="w-full" onClick={() => router.replace("/dashboard")}>
            Continuer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text">
      <Loader2 className="h-7 w-7 animate-spin text-brand-blue-electric" aria-hidden />
      <p className="text-[14px] text-text-soft">Connexion en cours…</p>
    </div>
  );
}
