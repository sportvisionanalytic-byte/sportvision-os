"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Shell de l'espace joueur — voir design-connect-personnel-12-08/README.md § Shell et
// navigation. Ne liste QUE les entrées réellement construites (Accueil, Mon profil) : le
// design final en a beaucoup plus (affiliations, équipes, prestations, cotisations...), mais
// les ajouter ici avant que la page existe créerait des liens morts ou des pages vides — contre
// le principe déjà établi dans ce projet ("jamais verrouillé avec un cadenas, jamais 'Bientôt
// disponible' : une entrée retirée plutôt qu'un cul-de-sac", cf. NAV_PLAYER dans app-next et le
// nettoyage "Bientôt disponible" de la nuit du 12/08). À étendre au fur et à mesure que chaque
// écran est réellement construit.

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Accueil", icon: "home" },
  { href: "/affiliations", label: "Mes affiliations", icon: "shield" },
  { href: "/profil", label: "Mon profil", icon: "person" },
];

export function AppShell({
  firstName,
  children,
}: {
  firstName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const monogram = (firstName[0] || "?").toUpperCase();

  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      {/* ============ SIDEBAR DESKTOP ============ */}
      <aside className="sticky top-0 hidden h-screen w-[252px] flex-none flex-col gap-6 border-r border-border p-3.5 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
          <Image src="/uploads/logo.png" alt="SportVision Connect" width={32} height={32} className="object-contain" />
          <div className="flex flex-col leading-tight">
            <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
            <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
              Connect
            </span>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-[42px] items-center gap-2.5 rounded-sv px-3 text-[14px] transition-colors duration-150 ${
                  active ? "bg-white/8 font-medium text-text" : "text-text-secondary hover:bg-white/[.05]"
                }`}
              >
                <span
                  className="material-symbols-rounded !text-[21px]"
                  style={{ color: active ? "#8CA9FF" : undefined }}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2.5 rounded-sv border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-hover"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-sv-gradient font-sora text-[13px] font-semibold text-white">
            {monogram}
          </span>
          <span className="flex flex-col gap-0.5 leading-tight">
            <span className="font-sora text-[13px] font-semibold">{firstName}</span>
            <span className="text-[11px] text-text-tertiary">Se déconnecter</span>
          </span>
        </button>
      </aside>

      {/* ============ HEADER MOBILE ============ */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-border bg-bg/90 px-4 py-3.5 backdrop-blur-md lg:hidden">
        <Image src="/uploads/logo.png" alt="SportVision Connect" width={28} height={28} className="object-contain" />
        <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
          Connect
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-sv bg-surface"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sv-gradient font-sora text-[12px] font-semibold text-white">
            {monogram}
          </span>
        </button>
      </div>

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute right-3 top-16 flex w-56 flex-col gap-1 rounded-sv-card border border-border bg-bg-elevated p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="flex h-11 items-center gap-2.5 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
              >
                <span className="material-symbols-rounded !text-[20px]">{item.icon}</span>
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-11 items-center gap-2.5 rounded-sv px-3 text-left text-[14px] text-danger hover:bg-white/5"
            >
              <span className="material-symbols-rounded !text-[20px]">logout</span>
              Se déconnecter
            </button>
          </div>
        </div>
      )}

      {/* ============ CONTENU ============ */}
      <main className="flex-1 pb-16 pt-[68px] lg:pb-0 lg:pt-0">
        <div className="mx-auto max-w-[1160px] px-5 py-7 lg:px-8">{children}</div>
      </main>

      {/* ============ BOTTOM NAV MOBILE ============ */}
      <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-bg/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-[48px] flex-col items-center justify-center gap-1"
            >
              <span
                className="material-symbols-rounded !text-[24px]"
                style={{ color: active ? "#8CA9FF" : "#7A7A9C" }}
              >
                {item.icon}
              </span>
              <span className="text-[10px]" style={{ color: active ? "#8CA9FF" : "#7A7A9C" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
