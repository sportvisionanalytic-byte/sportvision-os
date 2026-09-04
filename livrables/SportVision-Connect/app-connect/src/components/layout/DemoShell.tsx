"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";

// Shell de démonstration — copie volontairement simplifiée de AppShell.tsx pour /demo/* :
// mêmes sections de navigation, mais tous les liens pointent vers /demo/... (routes publiques,
// voir middleware.ts) au lieu des routes réelles protégées. Pas d'appel Supabase (pas d'avatar
// réel, "se déconnecter" ramène simplement à /demo) : cette page ne doit jamais dépendre d'une
// session, par construction, puisqu'elle est accessible sans connexion.
// Temporaire (demandé par Fouka le 19/08) — à retirer avec tout src/app/demo/ avant le
// lancement public si plus utile.

interface NavItem {
  href: string;
  label: string;
  icon: string;
  color: string;
}

// Connect V3 (04/09/2026) — même restructuration à 5 entrées que AppShell.tsx (voir son
// commentaire), reproduite ici pour que la démo reflète fidèlement le vrai parcours plutôt que de
// montrer une navigation obsolète à qui l'utilise pour se faire une idée du produit.
const NAV_SECTIONS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ href: "/demo/dashboard", label: "Accueil", icon: "home", color: "#8CA9FF" }] },
  {
    title: "Médias",
    items: [{ href: "/demo/contenus", label: "Mes contenus", icon: "photo_library", color: "#C084FC" }],
  },
  {
    title: "Mon univers",
    items: [
      { href: "/demo/affiliations", label: "Mon affiliation", icon: "shield", color: "#22D3EE" },
      { href: "/demo/equipes", label: "Mes équipes", icon: "groups", color: "#22D3EE" },
      { href: "/demo/calendrier", label: "Calendrier", icon: "calendar_month", color: "#8CA9FF" },
      { href: "/demo/messages", label: "Messages", icon: "forum", color: "#22D3EE" },
    ],
  },
  {
    title: "Services",
    items: [
      { href: "/demo/prestations", label: "Prestations", icon: "camera_alt", color: "#8CA9FF" },
      { href: "/demo/cotisations", label: "Paiement collectif", icon: "savings", color: "#F472B6" },
      { href: "/demo/commandes", label: "Mes commandes", icon: "receipt_long", color: "#8CA9FF" },
      { href: "/demo/factures", label: "Factures & paiements", icon: "payments", color: "#FBBF24" },
    ],
  },
  {
    title: "Mon compte",
    items: [{ href: "/demo/profil", label: "Mon profil", icon: "person", color: "#22D3EE" }],
  },
];

const MOBILE_TABS: NavItem[] = [
  { href: "/demo/dashboard", label: "Accueil", icon: "home", color: "#8CA9FF" },
  { href: "/demo/medias", label: "Médias", icon: "photo_library", color: "#C084FC" },
  { href: "/demo/mon-univers", label: "Mon univers", icon: "groups", color: "#22D3EE" },
  { href: "/demo/services", label: "Services", icon: "camera_alt", color: "#8CA9FF" },
  { href: "/demo/profil", label: "Profil", icon: "person", color: "#22D3EE" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DemoShell({ firstName, children }: { firstName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-sv-gradient px-4 py-2 text-center text-[12.5px] font-semibold text-white">
        <span className="material-symbols-rounded !text-[16px]" aria-hidden="true">visibility</span>
        Mode démonstration — données fictives, aucune action réelle
      </div>

      <aside className="sticky top-9 hidden h-[calc(100vh-36px)] w-[252px] flex-none flex-col gap-5 overflow-y-auto border-r border-border p-3.5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Link href="/demo/dashboard" className="flex flex-1 items-center gap-2.5">
            <Image src="/uploads/logo.png" alt="SportVision Connect" width={32} height={32} className="object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
              <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
                Connect
              </span>
            </div>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-4">
          {NAV_SECTIONS.map((section, i) => (
            <div key={section.title ?? `section-${i}`} className="flex flex-col gap-1">
              {section.title && (
                <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[.1em] text-text-faint">
                  {section.title}
                </span>
              )}
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex h-[42px] items-center gap-2.5 rounded-sv px-3 text-[14px] transition-colors duration-150 ${
                      active ? "bg-white/8 font-medium text-text" : "text-text-secondary hover:bg-white/[.05]"
                    }`}
                  >
                    <span className="material-symbols-rounded !text-[21px]" style={{ color: item.color, opacity: active ? 1 : 0.62 }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <Link
          href="/auth/login"
          className="flex items-center gap-2.5 rounded-sv border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-hover"
        >
          <Avatar url={null} label={firstName} size={36} className="text-[13px]" />
          <span className="flex flex-col gap-0.5 leading-tight">
            <span className="font-sora text-[13px] font-semibold">{firstName}</span>
            <span className="text-[11px] text-text-tertiary">Quitter la démo</span>
          </span>
        </Link>
      </aside>

      <div className="fixed inset-x-0 top-9 z-30 flex items-center gap-3 border-b border-border bg-bg/90 px-4 py-3.5 backdrop-blur-md lg:hidden">
        <Image src="/uploads/logo.png" alt="SportVision Connect" width={28} height={28} className="object-contain" />
        <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
          Connect · Démo
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-sv bg-surface"
        >
          <Avatar url={null} label={firstName} size={32} className="text-[12px]" />
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div
            className="absolute right-3 top-20 flex max-h-[calc(100vh-88px)] w-64 flex-col gap-3 overflow-y-auto rounded-sv-card border border-border bg-bg-elevated p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_SECTIONS.map((section, i) => (
              <div key={section.title ?? `msection-${i}`} className="flex flex-col gap-1">
                {section.title && (
                  <span className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[.1em] text-text-faint">
                    {section.title}
                  </span>
                )}
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex h-11 items-center gap-2.5 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
                  >
                    <span className="material-symbols-rounded !text-[20px]" style={{ color: item.color }} aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
            <Link
              href="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="flex h-11 items-center gap-2.5 rounded-sv px-3 text-left text-[14px] text-danger hover:bg-white/5"
            >
              <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">logout</span>
              Quitter la démo
            </Link>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-16 pt-[104px] lg:pb-0 lg:pt-9">
          <div className="mx-auto max-w-[1160px] px-5 py-7 lg:px-8">{children}</div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-bg/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        {MOBILE_TABS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className="flex min-h-[48px] flex-col items-center justify-center gap-1">
              <span className="material-symbols-rounded !text-[22px]" style={{ color: item.color, opacity: active ? 1 : 0.62 }}>
                {item.icon}
              </span>
              <span className="text-[10px]" style={{ color: active ? "#8CA9FF" : "#7A7A9C" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Connect V3 : plus de bouton "Plus" flottant, mêmes 5 onglets que le vrai Espace joueur. */}
    </div>
  );
}
