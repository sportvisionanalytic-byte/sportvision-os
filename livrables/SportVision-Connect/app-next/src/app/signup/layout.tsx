"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { SignupProvider, STEPS } from "./signup-context";

// Coque commune aux 7 étapes d'inscription — voir ACTIONS.md § 2. Même famille visuelle que
// /auth (pas de sidebar), avec une frise de progression numérotée propre au tunnel. Fichier
// nouveau, dédié à ce périmètre : ne touche à aucun layout partagé.
export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignupProvider>
      <div className="min-h-screen bg-bg text-text">
        <header className="border-b border-divider bg-bg-alt/60">
          <div className="mx-auto flex max-w-[880px] items-center justify-between px-6 py-5">
            <Link href="/auth/login" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[13px] font-extrabold text-white">
                SV
              </span>
              <span className="leading-tight">
                <span className="block text-[14px] font-extrabold tracking-tight">SportVision</span>
                <span className="block text-[10.5px] font-medium uppercase tracking-[.06em] text-brand-blue-pale">
                  Connect
                </span>
              </span>
            </Link>
            <div className="text-[13px] text-text-soft">
              Déjà un compte ?{" "}
              <Link href="/auth/login" className="font-extrabold text-brand-blue-electric">
                Se connecter
              </Link>
            </div>
          </div>
          <ProgressBar />
        </header>

        <main className="mx-auto max-w-[880px] px-6 py-10">{children}</main>
      </div>
    </SignupProvider>
  );
}

function ProgressBar() {
  const pathname = usePathname();
  const currentIndex = Math.max(
    0,
    STEPS.findIndex((s) => pathname === s.href),
  );
  const pct = (currentIndex / (STEPS.length - 1)) * 100;

  return (
    <div className="mx-auto max-w-[880px] px-6 pb-5">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-blue to-brand-violet transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[11.5px] font-bold">
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={step.href} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px]",
                  done && "bg-success-bg text-success-fg",
                  active && "bg-gradient-to-br from-brand-blue to-brand-violet text-white",
                  !done && !active && "bg-surface-sunken text-text-faint",
                )}
              >
                {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span className={cn(active ? "text-text" : "text-text-faint")}>{step.label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 flex-none bg-border" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
