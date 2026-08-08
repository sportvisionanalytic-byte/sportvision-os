"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, HelpCircle, LogOut } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { filterAffiliatedPlayerNav, resolveNavigation } from "@/lib/navigation";
import { formatPlanCredits, PLANS } from "@/lib/plans";
import { cn } from "@/lib/cn";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

export function Sidebar() {
  const pathname = usePathname();
  const { ctx } = useSession();

  const isAffiliatedPlayer = ctx.organization.type === "player" && !!ctx.organization.parentOrganizationId;
  let entries = resolveNavigation(ctx.organization.type, ctx.subscription.planCode);
  if (isAffiliatedPlayer) entries = filterAffiliatedPlayerNav(entries);

  const plan = PLANS[ctx.subscription.planCode];

  return (
    <aside className="sticky top-0 flex h-screen w-[264px] flex-none flex-col border-r border-white/5 bg-chrome">
      <div className="flex items-center gap-3 px-5 pb-3.5 pt-5">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[13px] font-extrabold text-white">
          SV
        </span>
        <span className="leading-tight text-white">
          <span className="block text-[14.5px] font-extrabold tracking-tight">SportVision</span>
          <span className="block text-[11px] font-medium uppercase tracking-[.06em] text-brand-blue-pale">
            Connect
          </span>
        </span>
      </div>

      <OrganizationSwitcher />

      <nav className="flex-1 overflow-y-auto px-3.5 pb-2 pt-4">
        {entries.map((entry, i) => {
          if (entry.kind === "section") {
            return (
              <div
                key={`s-${i}`}
                className="px-2.5 pb-1.5 pt-3.5 text-[10px] font-extrabold uppercase tracking-[.11em] text-[#5B6B96]"
              >
                {entry.label}
              </div>
            );
          }
          const active = pathname === entry.href || pathname?.startsWith(`${entry.href}/`);
          const unlocked = canAccess(ctx, entry.module);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={cn(
                "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors duration-sv",
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

      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
        <div className="rounded-[14px] border border-white/10 bg-gradient-to-br from-[rgba(36,75,255,.28)] to-[rgba(138,46,255,.24)] p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-extrabold tracking-tight text-white">{plan.name}</span>
            <span className="rounded-full bg-[rgba(18,183,106,.2)] px-1.5 py-0.5 text-[10px] font-extrabold text-[#7BE8C3]">
              ACTIF
            </span>
          </div>
          <div className="mt-2.5 flex justify-between text-[11px] font-semibold text-[#C6D3F0]">
            <span>Crédits</span>
            <span className="font-extrabold text-white">{formatPlanCredits(plan)}</span>
          </div>
          <Link
            href="/billing"
            className="mt-3 block w-full rounded-[9px] bg-white/[.13] py-1.5 text-center text-[12px] font-bold text-white transition-colors hover:bg-white/[.22]"
          >
            Gérer mon offre
          </Link>
        </div>

        <Link
          href="/support"
          className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[12.5px] font-semibold text-[#8595BE] transition-colors hover:bg-white/[.07] hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
          Aide &amp; support
        </Link>

        <div className="flex items-center gap-2.5 rounded-xl bg-white/[.04] p-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[11px] font-extrabold text-white">
            SM
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-bold text-white">
              {ctx.user.firstName} {ctx.user.lastName}
            </span>
            <span className="block truncate text-[11px] text-[#7E8FA5]">{ctx.user.jobTitle}</span>
          </span>
          <button
            aria-label="Se déconnecter"
            className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[#7E8FA5] transition-colors hover:bg-white/10"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}
