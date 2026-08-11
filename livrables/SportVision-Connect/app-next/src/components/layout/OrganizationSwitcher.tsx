"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/lib/types/settings";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function OrganizationSwitcher() {
  const { ctx, spaces, setActiveSpace } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Aucun clic-extérieur ni touche Échap ne fermait le menu : il restait ouvert par-dessus la
  // nav tant qu'on ne cliquait pas explicitement sur une de ses propres options. Trouvé en
  // testant le sélecteur en changeant plusieurs fois d'espace d'affilée.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative px-3.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.045] p-2.5 text-left transition-colors hover:bg-white/[.09]"
      >
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-gradient-to-br from-brand-blue-electric to-brand-cyan text-[11px] font-extrabold text-white">
          {initials(ctx.organization.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-white">{ctx.organization.name}</span>
          <span className="block truncate text-[11px] font-semibold text-[#7E8FA5]">
            {ROLE_LABELS[ctx.membership.role] ?? ctx.membership.role}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 flex-none text-[#7E8FA5]" aria-hidden />
      </button>

      {open && (
        <div className="animate-svfade absolute left-3.5 right-3.5 top-[58px] z-50 rounded-2xl border border-white/10 bg-elevated p-2 shadow-sv-dropdown">
          <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-extrabold uppercase tracking-[.09em] text-[#7E8FA5]">
            Mes espaces
          </div>
          {spaces.map((space) => {
            const isActive = space.kind === "organization" && space.id === ctx.organization.id;
            return (
              <button
                key={`${space.kind}:${space.id}`}
                disabled={!space.clickable}
                onClick={() => {
                  if (!space.clickable) return;
                  setActiveSpace(space);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                  space.clickable ? "hover:bg-white/[.08]" : "cursor-not-allowed opacity-50",
                  isActive && "bg-white/[.06]",
                )}
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[10.5px] font-extrabold text-white">
                  {initials(space.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold text-white">{space.name}</span>
                  <span className="block truncate text-[11px] text-[#7E8FA5]">{space.subtitle}</span>
                </span>
                {!space.clickable && (
                  <span className="flex-none rounded-full bg-white/10 px-2 py-0.5 text-[9.5px] font-bold text-[#7E8FA5]">
                    Bientôt
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
