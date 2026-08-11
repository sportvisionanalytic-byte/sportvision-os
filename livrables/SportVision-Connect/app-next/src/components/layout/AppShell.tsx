"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

// Coque cliente de l'app authentifiée — porte l'état du drawer mobile (Sidebar en dessous de
// `lg`, voir Sidebar.tsx) partagé entre le bouton hamburger du Header et le panneau de la
// Sidebar elle-même. Ce state doit vivre au-dessus des deux pour que le Header (qui ouvre)
// et la Sidebar (qui affiche/ferme) restent synchronisés sans prop drilling depuis le layout
// serveur. Voir (app)/layout.tsx qui monte ce composant sous SessionProvider.
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  // Referme le drawer à chaque changement de route — évite qu'il reste ouvert par-dessus la
  // page suivante après un clic sur un lien de nav. Ne se déclenche pas sur un simple
  // changement d'organisation active (setActiveSpace ne change pas le pathname, seulement
  // router.refresh()), ce qui est le comportement attendu : le drawer reste ouvert le temps
  // du changement d'espace.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Empêche le scroll de la page derrière l'overlay quand le drawer mobile est ouvert.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  // Échap ferme le drawer — accessibilité clavier.
  useEffect(() => {
    if (!mobileNavOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavOpen]);

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-7 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
