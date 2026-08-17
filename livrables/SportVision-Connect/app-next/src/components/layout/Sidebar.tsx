"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock, HelpCircle, LogOut, Shield, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { filterAffiliatedPlayerNav, filterClubRoleNav, resolveNavigation } from "@/lib/navigation";
import { formatPlanCredits, PLANS } from "@/lib/plans";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { fetchPlayerClubInfo, type PlayerClubInfo } from "@/lib/data/player/club-info";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

interface SidebarProps {
  // Drawer mobile (sous `lg`, voir AppShell.tsx) — au-delà de `lg` la sidebar reste statique
  // sticky comme avant, ces deux props n'ont alors aucun effet visuel.
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { ctx } = useSession();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const isPlayer = ctx.organization.type === "player";
  const isAffiliatedPlayer = isPlayer && !!ctx.organization.parentOrganizationId;
  let entries = resolveNavigation(ctx.organization.type, ctx.subscription.planCode);
  if (isAffiliatedPlayer) entries = filterAffiliatedPlayerNav(entries);
  if (ctx.organization.type === "club") entries = filterClubRoleNav(entries, ctx.membership.role, ctx.membership.teamScope);

  // Un éducateur (coach) de club n'a pas de crédits/offre à gérer (§11 du master doc, ligne
  // "Offre / crédits" = Non) : le lien "Gérer mon offre" mènerait de toute façon à /billing,
  // retiré de son menu ci-dessus. Remplacé par une carte club légère (même famille visuelle que
  // la carte joueur) plutôt que masquée, pour ne pas laisser un vide en bas de sidebar.
  const isClubEducateur = ctx.organization.type === "club" && ctx.membership.role === "coach";

  const plan = PLANS[ctx.subscription.planCode];
  const initials = `${ctx.user.firstName[0] ?? ""}${ctx.user.lastName[0] ?? ""}`.toUpperCase() || "?";

  // Carte "offre/crédits" remplacée par une carte club pour un espace Joueur : "Prestation
  // unique / 1 crédit par mois / Gérer mon offre" n'a aucun sens pour un joueur affilié à un club
  // (brief Fouka § 18) — il n'a ni offre ni crédits personnels, juste un club et une équipe.
  const [clubInfo, setClubInfo] = useState<PlayerClubInfo | null>(null);
  useEffect(() => {
    if (!isAffiliatedPlayer || !ctx.organization.parentOrganizationId) return;
    const supabase = createClient();
    fetchPlayerClubInfo(supabase, ctx.organization.parentOrganizationId, ctx.organization.id)
      .then(setClubInfo)
      .catch(() => setClubInfo(null));
  }, [isAffiliatedPlayer, ctx.organization.parentOrganizationId, ctx.organization.id]);

  return (
    <>
      {/* Overlay mobile — même convention que src/app/(app)/requests/page.tsx (bg-black/50,
          role="dialog"). Recouvre tout, y compris le Header (z inférieur), pour rester
          "par-dessus le contenu" comme demandé plutôt que de le pousser. Invisible et
          non-interactif (pointer-events-none) au repos pour ne jamais capter de clics quand
          le drawer est fermé, y compris sur desktop où il n'est jamais activé. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-sv lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        role="dialog"
        aria-modal={mobileOpen}
        aria-label="Navigation principale"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-[264px] max-w-[85vw] flex-none flex-col border-r border-white/5 bg-chrome transition-transform duration-300 ease-in-out",
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
            <span className="block text-[11px] font-medium uppercase tracking-[.06em] text-brand-blue-pale">
              Connect
            </span>
          </span>
          <button
            aria-label="Fermer le menu"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[#7E8FA5] transition-colors hover:bg-white/10 lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
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
                onClick={onClose}
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
          {isPlayer ? (
            <div className="rounded-[14px] border border-white/10 bg-gradient-to-br from-[rgba(36,75,255,.28)] to-[rgba(138,46,255,.24)] p-3.5">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 flex-none text-brand-blue-pale" aria-hidden />
                <span className="truncate text-[12.5px] font-extrabold uppercase tracking-tight text-white">
                  {clubInfo?.clubName ?? "Votre club"}
                </span>
              </div>
              <div className="mt-2.5 flex flex-col gap-1 text-[11px] font-semibold text-[#C6D3F0]">
                <div className="flex justify-between">
                  <span>Rôle</span>
                  <span className="font-extrabold text-white">Joueur</span>
                </div>
                {clubInfo?.teamName && (
                  <div className="flex justify-between">
                    <span>Équipe</span>
                    <span className="font-extrabold text-white">
                      {clubInfo.teamName}
                      {clubInfo.categorie ? ` · ${clubInfo.categorie}` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : isClubEducateur ? (
            <div className="rounded-[14px] border border-white/10 bg-gradient-to-br from-[rgba(36,75,255,.28)] to-[rgba(138,46,255,.24)] p-3.5">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 flex-none text-brand-blue-pale" aria-hidden />
                <span className="truncate text-[12.5px] font-extrabold uppercase tracking-tight text-white">
                  {ctx.organization.name}
                </span>
              </div>
              <div className="mt-2.5 flex flex-col gap-1 text-[11px] font-semibold text-[#C6D3F0]">
                <div className="flex justify-between">
                  <span>Rôle</span>
                  <span className="font-extrabold text-white">Éducateur</span>
                </div>
                {ctx.membership.teamScope.length > 0 && (
                  <div className="flex justify-between">
                    <span>Équipe</span>
                    <span className="font-extrabold text-white">{ctx.membership.teamScope.join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
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
                onClick={onClose}
                className="mt-3 block w-full rounded-[9px] bg-white/[.13] py-2.5 text-center text-[12px] font-bold text-white transition-colors hover:bg-white/[.22]"
              >
                Gérer mon offre
              </Link>
            </div>
          )}

          <Link
            href="/support"
            onClick={onClose}
            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[12.5px] font-semibold text-[#8595BE] transition-colors hover:bg-white/[.07] hover:text-white"
          >
            <HelpCircle className="h-4 w-4" aria-hidden />
            Aide &amp; support
          </Link>

          <div className="flex items-center gap-2.5 rounded-xl bg-white/[.04] p-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[11px] font-extrabold text-white">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-bold text-white">
                {ctx.user.firstName} {ctx.user.lastName}
              </span>
              {ctx.user.jobTitle && (
                <span className="block truncate text-[11px] text-[#7E8FA5]">{ctx.user.jobTitle}</span>
              )}
            </span>
            {/* h-9/w-9 (36px, convention Header.tsx) au lieu de 26px — cible tactile trop petite
                pour un bouton isolé, trouvé à l'audit mobile 375-430px. */}
            <button
              aria-label="Se déconnecter"
              onClick={handleLogout}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[#7E8FA5] transition-colors hover:bg-white/10"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
