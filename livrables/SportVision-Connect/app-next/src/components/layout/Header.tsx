"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, HelpCircle, Moon, Plus, Search, Sun } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

// Barre supérieure — voir CHARTE.md et ACTIONS.md § 4. Tous les contrôles de droite portent
// une largeur fixe ; seul le bloc titre s'étire.

export function Header() {
  const pathname = usePathname();
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

  const title = pathname === "/dashboard" ? "Tableau de bord" : pathname?.slice(1) || "Accueil";

  return (
    <header className="sticky top-0 z-40 flex h-[66px] items-center gap-4 border-b border-divider bg-bg/85 px-7 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-text-faint">{ctx.organization.name}</div>
        <div className="truncate text-[18px] font-extrabold capitalize tracking-tight">{title}</div>
      </div>

      <div className="relative w-[270px] flex-none">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-faint" aria-hidden />
        <input
          placeholder="Rechercher un contenu, une demande…"
          className="h-9 w-full rounded-[11px] border border-border-strong bg-input-bg pl-8 pr-3 text-[13px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.1)]"
        />
      </div>

      <button className="flex h-9 flex-none items-center gap-1.5 rounded-[11px] bg-gradient-to-br from-brand-blue-electric to-brand-violet px-3.5 text-[13px] font-bold text-white shadow-sv-button">
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Nouvelle demande
      </button>

      <button
        aria-label="Notifications"
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
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </button>

      <button
        aria-label="Mon profil"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[12px] font-extrabold text-white"
      >
        SM
      </button>
    </header>
  );
}
