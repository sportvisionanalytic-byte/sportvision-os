"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/cn";

const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  communication_manager: "Responsable communication",
  player: "Joueur",
  parent: "Parent",
  coach: "Coach",
  admin: "Administrateur",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function OrganizationSwitcher() {
  const { ctx, organizations, setActiveOrganizationId } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative px-3.5">
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
            Mes organisations
          </div>
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => {
                setActiveOrganizationId(org.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-white/[.08]",
                org.id === ctx.organization.id && "bg-white/[.06]",
              )}
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[10.5px] font-extrabold text-white">
                {initials(org.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-white">{org.name}</span>
                <span className="block truncate text-[11px] text-[#7E8FA5]">{org.type}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
