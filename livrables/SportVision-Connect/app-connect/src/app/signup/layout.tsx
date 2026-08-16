"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SignupProvider, STEPS, useSignup } from "./signup-context";
import { LEGAL_URLS } from "@/lib/legal-links";

// Layout du tunnel d'inscription — barre de progression + fil d'Ariane, voir
// design-connect-personnel-12-08/README.md § Inscription. Le SignupProvider englobe toutes
// les étapes : le contexte survit à la navigation interne au groupe de routes /signup/*.
export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignupProvider>
      <SignupShell>{children}</SignupShell>
    </SignupProvider>
  );
}

function SignupShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSignup();
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.href === pathname));
  const progress = ((stepIndex + 1) / STEPS.length) * 100;
  const showProgress = stepIndex >= 0 && pathname !== "/signup/verify" && pathname !== "/signup/done";

  // Labels des étapes 3/4 adaptés au profil choisi à l'étape 2 — les pages elles-mêmes
  // (signup/sport, signup/club) branchent déjà leur contenu sur isSportLike/isParticulier/etc.
  // (aucun sportif n'y voit de sélecteur "Club"), mais le fil d'Ariane restait figé sur
  // "Sport"/"Club" pour tout le monde — un parent qui répond "J'accompagne un sportif" voyait
  // quand même "Sport" puis "Club" au-dessus d'un écran qui ne parle ni de sport ni de club.
  // Trouvé par audit externe le 16/08 (confondu à tort avec "le parcours ne branche jamais" —
  // vérifié faux dans le code, seul le libellé du stepper ne suivait pas).
  const isSportLike = state.profile === "joueur" || state.profile === "sportif";
  const isParticulier = state.profile === "particulier";
  const stepLabels = STEPS.map((s, i) => {
    if (i === 2) return isSportLike ? "Sport" : isParticulier ? "Besoin" : "Espace";
    if (i === 3) return isSportLike ? "Affiliation" : "Finalisation";
    return s.label;
  });

  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-text">
      <div className="flex flex-none items-center justify-between gap-5 px-7 py-[22px]">
        <Link href="/auth/login" className="flex items-center gap-2.5 text-text">
          <Image src="/uploads/logo.png" alt="SportVision Connect" width={32} height={32} className="object-contain" />
          <div className="flex flex-col leading-tight">
            <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
            <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
              Connect
            </span>
          </div>
        </Link>
        <Link href="/auth/login" className="text-[13px] font-medium text-text-tertiary hover:text-text">
          J&apos;ai déjà un compte
        </Link>
      </div>

      <div className="flex flex-1 justify-center px-6 pb-8 pt-2">
        <div className="flex w-full max-w-[560px] flex-col gap-[26px]">
          {showProgress && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={() => router.back()}
                  aria-label="Retour"
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-sv border border-border bg-surface text-text-secondary hover:bg-surface-hover"
                >
                  <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">arrow_back</span>
                </button>
                <div className="h-[5px] flex-1 overflow-hidden rounded-sv-pill bg-white/10">
                  <div
                    className="h-full rounded-sv-pill bg-sv-gradient transition-[width] duration-[400ms] ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="flex-none font-mono text-[11px] text-text-tertiary">
                  Étape {stepIndex + 1} sur {STEPS.length}
                </span>
              </div>
              <div className="flex gap-4 pl-[54px]">
                {STEPS.map((s, i) => (
                  <span
                    key={s.href}
                    className={`text-[12px] font-medium ${
                      i === stepIndex ? "text-text" : i < stepIndex ? "text-[#8CA9FF]" : "text-text-label"
                    }`}
                  >
                    {stepLabels[i]}
                  </span>
                ))}
              </div>
            </div>
          )}
          {children}

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-2 text-[12px] text-text-label">
            <a href={LEGAL_URLS.mentionsLegales} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
              Mentions légales
            </a>
            <a href={LEGAL_URLS.confidentialite} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
              Confidentialité
            </a>
            <a href={LEGAL_URLS.cgv} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
              Conditions d&apos;utilisation
            </a>
            <Link href="/aide" className="hover:text-text-tertiary">
              Aide
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
