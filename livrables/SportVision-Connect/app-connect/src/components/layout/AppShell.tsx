"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAvatarUrl } from "@/lib/supabase/session";
import { Avatar } from "@/components/ui/Avatar";
import { Topbar } from "./Topbar";
import { NotificationBell } from "./NotificationBell";
import { MobileSearchOverlay } from "./MobileSearchOverlay";

// Shell de l'espace joueur — voir design-connect-personnel-12-08/README.md § Shell et
// navigation. Structure consolidée le 14/08 une fois tous les écrans du design réellement
// construits (Mes affiliations, Mes équipes, Prestations, Cotisations, Mes contenus, Mes
// commandes, Calendrier, Messages, Factures & paiements, Mon profil) : reprend les 3 sections
// du design (MON UNIVERS / SPORTVISION / MON COMPTE) plutôt que la liste plate provisoire
// utilisée pendant la construction progressive. "Accès à mon profil" reste volontairement
// hors navigation (le design ne l'y met pas non plus — atteint depuis la carte dédiée dans Mon
// profil et une notification, cf. rapport de l'agent Accueil/Profil/Accès du 14/08).
//
// Topbar (desktop, 76 px) + notifications/recherche mobile ajoutées le 14/08 (chantier topbar
// transverse, voir migration-connect-v53-topbar-notifications-recherche.sql) : le `?` d'aide
// quitte la sidebar (unique accès désormais dans Topbar.tsx, README § Shell : "L'aide n'est pas
// dans la sidebar"), inchangé côté header mobile (pattern distinct, hors périmètre topbar 76 px).

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_SECTIONS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ href: "/dashboard", label: "Accueil", icon: "home" }] },
  {
    title: "Mon univers",
    items: [
      { href: "/affiliations", label: "Mes affiliations", icon: "shield" },
      { href: "/equipes", label: "Mes équipes", icon: "groups" },
    ],
  },
  {
    title: "SportVision",
    items: [
      { href: "/prestations", label: "Prestations", icon: "camera_alt" },
      { href: "/cotisations", label: "Cotisations", icon: "savings" },
      { href: "/contenus", label: "Mes contenus", icon: "photo_library" },
      { href: "/commandes", label: "Mes commandes", icon: "receipt_long" },
      { href: "/calendrier", label: "Calendrier", icon: "calendar_month" },
      { href: "/messages", label: "Messages", icon: "forum" },
    ],
  },
  {
    title: "Mon compte",
    items: [
      { href: "/factures", label: "Factures & paiements", icon: "payments" },
      { href: "/profil", label: "Mon profil", icon: "person" },
    ],
  },
];

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

// 5 onglets principaux mobile (README § Mobile) : le reste passe par la feuille "Plus".
const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Accueil", icon: "home" },
  { href: "/contenus", label: "Contenus", icon: "photo_library" },
  { href: "/prestations", label: "Prestations", icon: "camera_alt" },
  { href: "/cotisations", label: "Cotisations", icon: "savings" },
  { href: "/profil", label: "Profil", icon: "person" },
];
const MOBILE_MORE_ITEMS: NavItem[] = ALL_ITEMS.filter(
  (item) => !MOBILE_TABS.some((t) => t.href === item.href),
);

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  firstName,
  lastName,
  email,
  children,
}: {
  firstName: string;
  lastName?: string;
  email?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Photo de profil (migration-connect-v55-photo-profil.sql) — chargée une fois côté client
  // (le shell ne reçoit que firstName/lastName/email en props depuis les ~20 pages qui le
  // rendent ; ajouter avatarUrl à chacune aurait été un changement mécanique bien plus large
  // pour le même résultat). getAvatarUrl fonctionne aussi bien avec le client navigateur
  // qu'avec le client serveur (aucune dépendance à next/headers), voir lib/supabase/session.ts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const url = await getAvatarUrl(supabase, userId);
      if (!cancelled) setAvatarUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }


  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      {/* ============ SIDEBAR DESKTOP ============ */}
      <aside className="sticky top-0 hidden h-screen w-[252px] flex-none flex-col gap-5 overflow-y-auto border-r border-border p-3.5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Link href="/dashboard" className="flex flex-1 items-center gap-2.5">
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
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2.5 rounded-sv border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-hover"
        >
          <Avatar url={avatarUrl} label={firstName} size={36} className="text-[13px]" />
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
          onClick={() => setMobileSearchOpen(true)}
          aria-label="Rechercher"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-sv text-text-tertiary hover:bg-surface"
        >
          <span className="material-symbols-rounded !text-[20px]">search</span>
        </button>
        <NotificationBell />
        <Link
          href="/aide"
          aria-label="Aide"
          className="flex h-9 w-9 items-center justify-center rounded-sv text-text-tertiary hover:bg-surface"
        >
          <span className="material-symbols-rounded !text-[20px]">help</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-sv bg-surface"
        >
          <Avatar url={avatarUrl} label={firstName} size={32} className="text-[12px]" />
        </button>
      </div>

      {mobileSearchOpen && <MobileSearchOverlay space="joueur" onClose={() => setMobileSearchOpen(false)} />}

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute right-3 top-16 flex max-h-[calc(100vh-88px)] w-64 flex-col gap-3 overflow-y-auto rounded-sv-card border border-border bg-bg-elevated p-2"
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
                    <span className="material-symbols-rounded !text-[20px]">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
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

      {/* ============ COLONNE DE CONTENU (topbar desktop + contenu) ============ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar space="joueur" firstName={firstName} lastName={lastName} email={email} avatarUrl={avatarUrl} profileHref="/profil" />
        <main className="flex-1 pb-16 pt-[68px] lg:pb-0 lg:pt-0">
          <div className="mx-auto max-w-[1160px] px-5 py-7 lg:px-8">{children}</div>
        </main>
      </div>

      {/* ============ BOTTOM NAV MOBILE (5 onglets + feuille "Plus") ============ */}
      <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-bg/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        {MOBILE_TABS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-[48px] flex-col items-center justify-center gap-1"
            >
              <span
                className="material-symbols-rounded !text-[22px]"
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

      {/* Bouton "Plus" flottant mobile — accès aux entrées hors des 5 onglets principaux */}
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="Plus d'options"
        className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-sv-gradient text-white shadow-lg lg:hidden"
      >
        <span className="material-symbols-rounded !text-[22px]">apps</span>
      </button>

      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-t-sv-card border-t border-border bg-bg-elevated p-3 pb-[max(16px,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/15" />
            <span className="px-2 pb-1 font-sora text-[15px] font-semibold">Plus</span>
            {MOBILE_MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex h-12 items-center gap-3 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
              >
                <span className="material-symbols-rounded !text-[21px]">{item.icon}</span>
                {item.label}
              </Link>
            ))}
            <Link
              href="/aide"
              onClick={() => setMoreOpen(false)}
              className="flex h-12 items-center gap-3 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
            >
              <span className="material-symbols-rounded !text-[21px]">help</span>
              Aide
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
