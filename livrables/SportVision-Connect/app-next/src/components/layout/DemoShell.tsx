"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock, Menu, X } from "lucide-react";
import { canAccess } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { DEMO_PROFILES, type DemoProfile } from "@/lib/demo/profiles";

// Coque de la démo publique Club+ (/demo/[profile]/...) — équivalent de AppShell+Sidebar pour un
// profil fictif. Ne dépend jamais de useSession()/SessionProvider (aucune session réelle en
// démo) : reçoit le DemoProfile déjà résolu par le layout serveur du segment [profile].
export function DemoShell({ profile, children }: { profile: DemoProfile; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const groups = Array.from(new Set(DEMO_PROFILES.map((p) => p.group)));

  function switchProfile(key: string) {
    router.push(`/demo/${key}/dashboard`);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <div
        aria-hidden
        onClick={() => setMobileOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-[280px] max-w-[85vw] flex-none flex-col overflow-y-auto border-r border-white/5 bg-chrome transition-transform duration-300 ease-in-out",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-w-none lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 pb-3.5 pt-5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[13px] font-extrabold text-white">
            SV
          </span>
          <span className="leading-tight text-white">
            <span className="block text-[14.5px] font-extrabold tracking-tight">SportVision</span>
            <span className="block text-[11px] font-medium uppercase tracking-[.06em] text-brand-blue-pale">Club+</span>
          </span>
          <button
            aria-label="Fermer le menu"
            onClick={() => setMobileOpen(false)}
            className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[#7E8FA5] transition-colors hover:bg-white/10 lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="px-3.5 pb-3">
          <label htmlFor="demo-profile-select" className="block px-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-[.11em] text-[#5B6B96]">Profil de démonstration</label>
          <select
            id="demo-profile-select"
            value={profile.key}
            onChange={(e) => switchProfile(e.target.value)}
            className="w-full rounded-[10px] border border-white/10 bg-white/[.06] px-2.5 py-2 text-[12.5px] font-semibold text-white outline-none"
          >
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {DEMO_PROFILES.filter((p) => p.group === g).map((p) => (
                  <option key={p.key} value={p.key} className="bg-chrome text-white">
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="mt-2 truncate text-[11.5px] font-semibold text-[#8595BE]">{profile.ctx.organization.name}</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3.5 pb-2 pt-1">
          {profile.nav.map((entry, i) => {
            if (entry.kind === "section") {
              return (
                <div key={`s-${i}`} className="px-2.5 pb-1.5 pt-3.5 text-[10px] font-extrabold uppercase tracking-[.11em] text-[#5B6B96]">
                  {entry.label}
                </div>
              );
            }
            const href = `/demo/${profile.key}${entry.href}`;
            const active = pathname === href;
            const unlocked = canAccess(profile.ctx, entry.module);
            return (
              <Link
                key={entry.href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors duration-150",
                  active
                    ? "bg-gradient-to-r from-[rgba(36,75,255,.34)] to-[rgba(138,46,255,.28)] font-bold text-white"
                    : "font-semibold text-[#95A4CC] hover:bg-white/[.07] hover:text-white",
                )}
              >
                <span className="flex-1">{entry.label}</span>
                {!unlocked && <Lock className="h-3.5 w-3.5 flex-none text-[#5B6B96]" aria-hidden />}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-2 px-3.5 pb-4 pt-3">
          <Link
            href="/auth/login"
            className="flex h-10 items-center justify-center rounded-[10px] bg-white/[.08] text-[12.5px] font-bold text-white transition-colors hover:bg-white/[.16]"
          >
            Quitter la démo
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-center text-[12px] font-semibold text-white"
          style={{ background: "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)" }}
        >
          Mode démonstration — données fictives, aucune action réelle
        </div>
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-7 lg:hidden">
          <button
            aria-label="Ouvrir le menu"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary"
          >
            <Menu className="h-4 w-4" aria-hidden />
          </button>
          <span className="text-[13.5px] font-bold text-text">{profile.label}</span>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-7 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
