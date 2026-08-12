"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SignupProvider, STEPS } from "./signup-context";

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
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.href === pathname));
  const progress = ((stepIndex + 1) / STEPS.length) * 100;
  const showProgress = stepIndex >= 0 && pathname !== "/signup/verify" && pathname !== "/signup/done";

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
                  <span className="material-symbols-rounded !text-[20px]">arrow_back</span>
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
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
