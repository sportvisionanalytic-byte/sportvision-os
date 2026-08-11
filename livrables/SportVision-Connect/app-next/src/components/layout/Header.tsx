"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, HelpCircle, Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";
import { resolveNavigation } from "@/lib/navigation";

// Barre supérieure — voir CHARTE.md et ACTIONS.md § 4. Tous les contrôles de droite portent
// une largeur fixe ; seul le bloc titre s'étire. Sous `lg` (drawer mobile, voir Sidebar.tsx et
// AppShell.tsx), un bouton hamburger ouvre la navigation. z-30 (plutôt que l'ancien z-40) pour
// rester sous l'overlay du drawer (z-40) : sans ça le header resterait visible/net par-dessus
// l'assombrissement de fond quand le drawer est ouvert.

// Routes jamais présentes dans la sidebar de l'espace courant (voir src/lib/navigation.ts) : soit
// jamais dans aucune nav (notifications, atteinte uniquement via la cloche), soit seulement dans
// la nav d'un autre type d'organisation (ex. /children et /authorizations, présentes uniquement
// pour l'espace Parent/Joueur — un admin de club qui y accède directement, par exemple depuis un
// lien partagé, ne doit pas voir le slug d'URL brut en titre). resolveNavigation() ne peut pas
// leur trouver de libellé pour l'espace actif : ce petit repli couvre ces cas précis.
const TITLE_FALLBACKS: Record<string, string> = {
  "/notifications": "Notifications",
  "/children": "Profils associés",
  "/authorizations": "Autorisations",
};

interface HeaderProps {
  onOpenMobileNav: () => void;
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { ctx } = useSession();
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  // Même source que la sidebar (resolveNavigation) : garantit le même libellé qu'elle affiche
  // pour la page courante (ex. "Mon espace" pour un joueur, "Accueil" pour un club — jamais un
  // "Tableau de bord" générique qui contredirait la sidebar). Repli sur TITLE_FALLBACKS pour les
  // routes volontairement absentes de la navigation, puis sur le segment d'URL brut en dernier
  // recours plutôt que de laisser le titre vide.
  const firstSegment = `/${pathname?.split("/")[1] ?? ""}`;
  const navEntries = resolveNavigation(ctx.organization.type, ctx.subscription.planCode);
  const navLabel = navEntries.find((e) => e.kind === "item" && e.href === firstSegment)?.label;
  const title = navLabel ?? TITLE_FALLBACKS[firstSegment] ?? (pathname?.slice(1) || "Accueil");
  const initials = `${ctx.user.firstName[0] ?? ""}${ctx.user.lastName[0] ?? ""}`.toUpperCase() || "?";

  return (
    <header className="sticky top-0 z-30 flex h-[66px] items-center gap-4 border-b border-divider bg-bg/85 px-7 backdrop-blur-xl">
      <button
        aria-label="Ouvrir le menu"
        onClick={onOpenMobileNav}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-text-faint">{ctx.organization.name}</div>
        <div className="truncate text-[18px] font-extrabold tracking-tight">{title}</div>
      </div>

      <div className="relative w-[270px] flex-none">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-faint" aria-hidden />
        <input
          placeholder="Rechercher un contenu, une demande…"
          className="h-9 w-full rounded-[11px] border border-border-strong bg-input-bg pl-8 pr-3 text-[13px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.1)]"
        />
      </div>

      <button
        onClick={() => router.push("/requests/new")}
        className="flex h-9 flex-none items-center gap-1.5 rounded-[11px] bg-gradient-to-br from-brand-blue-electric to-brand-violet px-3.5 text-[13px] font-bold text-white shadow-sv-button"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Nouvelle demande
      </button>

      <button
        aria-label="Notifications"
        onClick={() => router.push("/notifications")}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
      >
        <Bell className="h-4 w-4" aria-hidden />
      </button>

      <button
        aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
        onClick={toggleTheme}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
      </button>

      <button
        aria-label="Aide"
        onClick={() => router.push("/support")}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </button>

      <button
        aria-label="Mon profil"
        onClick={() => router.push("/settings/profile")}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[12px] font-extrabold text-white"
      >
        {initials}
      </button>
    </header>
  );
}
