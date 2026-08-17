"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { useSession } from "@/lib/session-context";
import type { Space } from "@/lib/supabase/session";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/lib/types/settings";

// CM externe — switcher (Bible §9 : "'Mon organisation' / mes espaces propres clairement
// séparés des 'Structures clientes'"). `space.role` (getSpaces, src/lib/supabase/session.ts)
// porte la valeur BRUTE de club_members.role — 'cm_externe' pour tout membership où ce compte
// est en mandat externe sur ce club précis (pas encore mappée via mapClubRole à ce stade, voir
// buildClubActiveContext qui ne fait cette conversion qu'une fois l'espace sélectionné). C'est
// exactement l'information "est-ce un mandat externe sur cette structure" que le brief demandait
// de vérifier avant de complexifier la couche session — elle est déjà là, pas besoin d'une
// nouvelle notion ExternalMandate ni de toucher session.ts/mappers.ts. Un compte sans aucun
// mandat externe (l'immense majorité) ne voit qu'un seul groupe, comme avant.
const EXTERNAL_MANDATE_ROLE = "cm_externe";

function isExternalMandate(space: Space): boolean {
  return space.kind === "organization" && space.role === EXTERNAL_MANDATE_ROLE;
}

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

  // "Mon organisation" / "Structures clientes" (Bible §9 CM externe / §20 "Séparer 'Mes
  // organisations' et 'Accès clients'") : deux groupes, même composant de ligne — pas deux
  // sélecteurs différents. Un compte sans aucun mandat cm_externe garde un seul groupe intitulé
  // "Mes espaces" comme avant (voir le libellé conditionnel plus bas), donc aucun changement
  // visuel pour l'immense majorité des comptes.
  const clientSpaces = spaces.filter(isExternalMandate);
  const ownSpaces = spaces.filter((s) => !isExternalMandate(s));

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
          {ownSpaces.length > 0 && (
            <>
              <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-extrabold uppercase tracking-[.09em] text-[#7E8FA5]">
                {clientSpaces.length > 0 ? "Mon organisation" : "Mes espaces"}
              </div>
              {ownSpaces.map((space) => (
                <SpaceRow
                  key={`${space.kind}:${space.id}`}
                  space={space}
                  isActive={space.kind === "organization" && space.id === ctx.organization.id}
                  onSelect={() => {
                    setActiveSpace(space);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}

          {clientSpaces.length > 0 && (
            <>
              <div className="mt-1.5 border-t border-white/10 px-2.5 pb-1.5 pt-2.5 text-[10.5px] font-extrabold uppercase tracking-[.09em] text-[#7E8FA5]">
                Structures clientes
              </div>
              {clientSpaces.map((space) => (
                <SpaceRow
                  key={`${space.kind}:${space.id}`}
                  space={space}
                  isActive={space.kind === "organization" && space.id === ctx.organization.id}
                  onSelect={() => {
                    setActiveSpace(space);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 17/08/2026 — getSpaces() ne filtre plus par statut (voir session.ts), un espace où
// l'utilisateur est seulement invité ou suspendu peut donc apparaître ici. Y basculer directement
// depuis ce switcher n'a pas de sens (RLS refuserait quand même toute donnée réelle, is_club_member
// vérifie status='actif' côté serveur) — l'acceptation doit passer par l'écran dédié
// (NoActiveSpace), jamais par un simple clic ici.
function isSwitchable(space: Space): boolean {
  return space.clickable && (space.status === undefined || space.status === "actif");
}

function SpaceRow({ space, isActive, onSelect }: { space: Space; isActive: boolean; onSelect: () => void }) {
  const switchable = isSwitchable(space);
  return (
    <button
      disabled={!switchable}
      onClick={() => {
        if (!switchable) return;
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors",
        switchable ? "hover:bg-white/[.08]" : "cursor-not-allowed opacity-50",
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
      {!switchable && (
        <span className="flex-none rounded-full bg-white/10 px-2 py-0.5 text-[9.5px] font-bold text-[#7E8FA5]">
          {space.status === "invitation" ? "Invitation en attente" : space.status === "suspendu" ? "Suspendu" : "Bientôt"}
        </span>
      )}
    </button>
  );
}
