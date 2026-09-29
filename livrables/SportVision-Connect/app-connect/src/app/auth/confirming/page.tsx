"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cheminInterne, consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { consumePendingClaim } from "@/lib/gallery/pending-claim";
import { messageErreurBase } from "@/lib/supabase/erreurs-serveur";

// Étape intermédiaire après /auth/callback (session déjà posée côté serveur à ce stade) :
// rejoue le pending onboarding — voir lib/signup/pending-onboarding.ts, ne peut se faire que
// côté client (localStorage) — avant d'atterrir sur /dashboard. L'échec n'empêche jamais d'entrer,
// mais il est MONTRÉ ici (voir plus bas, 29/09/2026) au lieu de partir dans la console.
//
// 10/09/2026 : la destination n'était jamais que /dashboard. Le parent parti de son invitation
// (/mes-invitations) ou du QR de l'équipe (/join/<code>) confirmait son adresse et arrivait sur un
// accueil qui ne lui disait rien de ce qui l'avait amené. `next` (transmis par /auth/callback)
// l'emporte, puis celui mémorisé avec l'inscription, puis /dashboard.
//
// 29/09/2026 — L'ÉCHEC DU RATTACHEMENT CLUB NE PART PLUS EN SILENCE DANS LA CONSOLE.
//
// C'est ici que se joue le choix fait à l'étape 4 du tunnel (« Rejoindre « US Exemple » »), et il
// peut être refusé pour une raison que la personne seule peut lever : « Votre club a déjà une fiche
// à ce nom. Pour la rattacher à votre compte, demandez le code d'invitation de votre équipe à votre
// coach ou au club, puis utilisez « J'ai un code ». » C'est le cas NORMAL chez un club partenaire
// qui a importé son effectif avant que la famille s'inscrive.
//
// Ce refus était journalisé puis oublié : la personne atterrissait sur son accueil sans club, sans
// message, et le rejeu échouait pareil à chaque connexion suivante. Elle n'avait aucun moyen de
// savoir que la porte existait. Club+ avait bouché ce trou le 10/09 dans son propre /auth/confirming
// — Connect, non. On montre la phrase, et on laisse entrer : l'adresse EST confirmée, et le compte
// fonctionne, club ou pas.
export default function ConfirmingPage() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [suiteApresErreur, setSuiteApresErreur] = useState("/dashboard");

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
        if (!cancelled) {
          setSuiteApresErreur(suite || "/dashboard");
          setErreur(messageErreurBase(e, "Votre rattachement au club n'a pas pu être finalisé."));
          return;
        }
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

  if (erreur) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-text">
        <div className="flex w-full max-w-[440px] flex-col gap-4 rounded-sv-card border border-border bg-surface p-7">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-sv-card bg-affiliations-bg">
            <span className="material-symbols-rounded !text-[26px] text-affiliations" aria-hidden="true">check_circle</span>
          </span>
          <h1 className="font-sora text-[22px] font-bold tracking-tight">Votre adresse est confirmée</h1>
          <p className="text-[14px] leading-relaxed text-text-secondary">
            Votre espace Connect est actif. En revanche, votre rattachement au club n&apos;a pas
            abouti : {erreur}
          </p>
          <div className="flex flex-col gap-2.5">
            <Link
              href="/affiliations/ajouter"
              className="flex h-[52px] items-center justify-center rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white hover:brightness-[1.08]"
            >
              Ajouter mon club
            </Link>
            <button
              type="button"
              onClick={() => {
                router.replace(suiteApresErreur);
                router.refresh();
              }}
              className="flex h-[52px] items-center justify-center rounded-sv border border-border-strong bg-surface font-sora text-[15px] font-semibold text-text hover:bg-surface-hover"
            >
              Plus tard, aller à mon espace
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text">
      <span className="material-symbols-rounded animate-spin !text-[28px] text-[#8CA9FF]" aria-hidden="true">progress_activity</span>
      <p className="text-[14px] text-text-tertiary">Connexion en cours…</p>
    </div>
  );
}
